// macc-proxy-helper: per-container proxy routing for Multi-Account Containers
// on Chromium.
//
// Chromium extensions can only set one proxy configuration for the whole
// browser, and PAC scripts never see which tab a request comes from. So the
// extension points every request at this helper (a local HTTP proxy) and
// tags each connection with its container:
//
//   - the helper challenges every CONNECT / plain-HTTP request with
//     407 Proxy Authentication Required;
//   - the extension answers from webRequest.onAuthRequired, which knows the
//     tab, with a one-time token it got from the helper for that container;
//   - the helper routes the connection through that container's upstream
//     proxy (http, https, socks4, socks5) or DIRECT.
//
// Tokens are single-use, so Chromium's cached proxy credentials can never
// tag a connection for the wrong container: a reused token is challenged
// again and the extension gets asked again.
//
// The helper is started by the browser through native messaging and talks to
// the extension over stdin/stdout (32-bit length-prefixed JSON).
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	httpdialer "github.com/mwitkow/go-http-dialer"
	"h12.io/socks"
)

const version = "1.2.0"

// Route is one container's upstream proxy. Type "" or "direct" means no proxy.
type Route struct {
	Type     string `json:"type"` // direct | http | https | socks | socks5 | socks4
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

func (r Route) key() string {
	if r.Type == "" || r.Type == "direct" {
		return "direct"
	}
	return fmt.Sprintf("%s://%s@%s:%d", r.Type, r.Username, r.Host, r.Port)
}

type ticket struct {
	ctx     string // container number as a string ("0" = default)
	site    string // top-level site of the tab that asked
	expires time.Time
}

type tunnel struct {
	ctx, site string
	conns     [2]net.Conn
}

type helper struct {
	mu      sync.Mutex
	routes  map[string]Route
	tickets map[string]ticket
	tunnels map[*tunnel]struct{}
	out     *json.Encoder
	outMu   sync.Mutex
}

func newHelper(w io.Writer) *helper {
	return &helper{
		routes:  map[string]Route{},
		tickets: map[string]ticket{},
		tunnels: map[*tunnel]struct{}{},
		out:     json.NewEncoder(w),
	}
}

// ---------------------------------------------------------------------------
// native messaging
// ---------------------------------------------------------------------------

func (h *helper) send(msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.outMu.Lock()
	defer h.outMu.Unlock()
	var n [4]byte
	binary.NativeEndian.PutUint32(n[:], uint32(len(b)))
	os.Stdout.Write(n[:])
	os.Stdout.Write(b)
}

type request struct {
	Type   string           `json:"type"`
	ID     any              `json:"id,omitempty"`
	Ctx    string           `json:"ctx,omitempty"`
	Site   string           `json:"site,omitempty"`
	Routes map[string]Route `json:"routes,omitempty"`
	Ctxs   []string         `json:"ctxs,omitempty"`
	// theme
	Extension string `json:"extension,omitempty"`
	Version   string `json:"version,omitempty"`
}

func (h *helper) readMessages(r io.Reader) error {
	br := bufio.NewReader(r)
	for {
		var n [4]byte
		if _, err := io.ReadFull(br, n[:]); err != nil {
			return err
		}
		size := binary.NativeEndian.Uint32(n[:])
		if size > 64<<20 {
			return errors.New("message too large")
		}
		buf := make([]byte, size)
		if _, err := io.ReadFull(br, buf); err != nil {
			return err
		}
		var req request
		if err := json.Unmarshal(buf, &req); err != nil {
			log.Printf("bad message: %v", err)
			continue
		}
		h.handle(req)
	}
}

func (h *helper) handle(req request) {
	switch req.Type {
	case "routes":
		h.mu.Lock()
		h.routes = req.Routes
		h.mu.Unlock()
		h.send(map[string]any{"type": "routes", "id": req.ID, "ok": true})
	case "token":
		tok := randomToken()
		h.mu.Lock()
		h.tickets[tok] = ticket{ctx: req.Ctx, site: req.Site, expires: time.Now().Add(2 * time.Minute)}
		h.mu.Unlock()
		h.send(map[string]any{"type": "token", "id": req.ID, "token": tok})
	case "flush":
		// Close tunnels opened for a top-level site by the given containers.
		closed := h.closeTunnels(func(t *tunnel) bool {
			if req.Site != "" && t.site != req.Site {
				return false
			}
			for _, c := range req.Ctxs {
				if c == t.ctx {
					return true
				}
			}
			return len(req.Ctxs) == 0
		})
		h.send(map[string]any{"type": "flush", "id": req.ID, "closed": closed})
	case "ping":
		h.send(map[string]any{"type": "pong", "id": req.ID})
	case "theme":
		h.send(map[string]any{"type": "theme", "id": req.ID, "theme": findTheme(req.Extension, req.Version)})
	case "search":
		h.send(map[string]any{"type": "search", "id": req.ID, "engine": findSearchEngine()})
	}
}

func randomToken() string {
	var b [18]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// ---------------------------------------------------------------------------
// proxy server
// ---------------------------------------------------------------------------

var errNoAuth = errors.New("missing or reused proxy token")

// authenticate consumes the one-time token in Proxy-Authorization.
func (h *helper) authenticate(r *http.Request) (ticket, Route, error) {
	auth := r.Header.Get("Proxy-Authorization")
	r.Header.Del("Proxy-Authorization")
	const prefix = "Basic "
	if !strings.HasPrefix(auth, prefix) {
		return ticket{}, Route{}, errNoAuth
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, prefix))
	if err != nil {
		return ticket{}, Route{}, errNoAuth
	}
	_, token, _ := strings.Cut(string(raw), ":")
	h.mu.Lock()
	defer h.mu.Unlock()
	t, ok := h.tickets[token]
	delete(h.tickets, token)
	now := time.Now()
	for k, v := range h.tickets {
		if now.After(v.expires) {
			delete(h.tickets, k)
		}
	}
	if !ok || now.After(t.expires) {
		return ticket{}, Route{}, errNoAuth
	}
	return t, h.routes[t.ctx], nil
}

func dialerFor(rt Route) func(network, addr string) (net.Conn, error) {
	direct := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	hostport := net.JoinHostPort(rt.Host, strconv.Itoa(rt.Port))
	userinfo := ""
	if rt.Username != "" {
		userinfo = url.UserPassword(rt.Username, rt.Password).String() + "@"
	}
	switch strings.ToLower(rt.Type) {
	case "", "direct":
		return direct.Dial
	case "socks", "socks5":
		return socks.Dial("socks5://" + userinfo + hostport + "?timeout=15s")
	case "socks4":
		return socks.Dial("socks4a://" + userinfo + hostport + "?timeout=15s")
	case "http", "https":
		u := &url.URL{Scheme: strings.ToLower(rt.Type), Host: hostport}
		if rt.Username != "" {
			return httpdialer.New(u, httpdialer.WithDialer(direct),
				httpdialer.WithProxyAuth(httpdialer.AuthBasic(rt.Username, rt.Password))).Dial
		}
		return httpdialer.New(u, httpdialer.WithDialer(direct)).Dial
	}
	return func(string, string) (net.Conn, error) {
		return nil, fmt.Errorf("unsupported proxy type %q", rt.Type)
	}
}

func challenge(w http.ResponseWriter) {
	w.Header().Set("Proxy-Authenticate", `Basic realm="Multi-Account Containers"`)
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusProxyAuthRequired)
	io.WriteString(w, "Multi-Account Containers: container token required\n")
}

func (h *helper) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	t, rt, err := h.authenticate(r)
	if err != nil {
		challenge(w)
		return
	}
	if r.Method == http.MethodConnect {
		h.serveConnect(w, r, t, rt)
		return
	}
	h.serveForward(w, r, rt)
}

func (h *helper) serveConnect(w http.ResponseWriter, r *http.Request, t ticket, rt Route) {
	upstream, err := dialerFor(rt)("tcp", r.Host)
	if err != nil {
		http.Error(w, "upstream: "+err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	client, buf, err := hj.Hijack()
	if err != nil {
		upstream.Close()
		return
	}
	client.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
	tun := &tunnel{ctx: t.ctx, site: t.site, conns: [2]net.Conn{client, upstream}}
	h.mu.Lock()
	h.tunnels[tun] = struct{}{}
	h.mu.Unlock()
	done := make(chan struct{}, 2)
	go func() {
		if n := buf.Reader.Buffered(); n > 0 {
			b, _ := buf.Reader.Peek(n)
			upstream.Write(b)
		}
		io.Copy(upstream, client)
		done <- struct{}{}
	}()
	go func() { io.Copy(client, upstream); done <- struct{}{} }()
	<-done
	client.Close()
	upstream.Close()
	h.mu.Lock()
	delete(h.tunnels, tun)
	h.mu.Unlock()
}

func (h *helper) closeTunnels(match func(*tunnel) bool) int {
	h.mu.Lock()
	var doomed []*tunnel
	for t := range h.tunnels {
		if match(t) {
			doomed = append(doomed, t)
		}
	}
	h.mu.Unlock()
	for _, t := range doomed {
		t.conns[0].Close()
		t.conns[1].Close()
	}
	return len(doomed)
}

var hopHeaders = []string{
	"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
	"Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

func (h *helper) serveForward(w http.ResponseWriter, r *http.Request, rt Route) {
	if r.URL.Scheme != "http" || r.URL.Host == "" {
		http.Error(w, "absolute http:// URL required", http.StatusBadRequest)
		return
	}
	tr := &http.Transport{DisableKeepAlives: true}
	switch strings.ToLower(rt.Type) {
	case "http", "https":
		u := &url.URL{Scheme: strings.ToLower(rt.Type), Host: net.JoinHostPort(rt.Host, strconv.Itoa(rt.Port))}
		if rt.Username != "" {
			u.User = url.UserPassword(rt.Username, rt.Password)
		}
		tr.Proxy = http.ProxyURL(u)
	default:
		dial := dialerFor(rt)
		tr.Dial = dial //nolint:staticcheck // h12.io/socks exposes a plain Dial func
	}
	out := r.Clone(r.Context())
	out.RequestURI = ""
	for _, k := range hopHeaders {
		out.Header.Del(k)
	}
	resp, err := tr.RoundTrip(out)
	if err != nil {
		http.Error(w, "upstream: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for _, k := range hopHeaders {
		resp.Header.Del(k)
	}
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v") {
		fmt.Println(version)
		return
	}
	log.SetOutput(os.Stderr)
	log.SetPrefix("macc-proxy-helper: ")
	h := newHelper(os.Stdout)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 30 * time.Second}
	go srv.Serve(ln)
	h.send(map[string]any{
		"type":    "hello",
		"version": version,
		"port":    ln.Addr().(*net.TCPAddr).Port,
	})
	// The browser closes stdin when the extension disconnects: exit then.
	if err := h.readMessages(os.Stdin); err != nil && !errors.Is(err, io.EOF) {
		log.Print(err)
	}
}
