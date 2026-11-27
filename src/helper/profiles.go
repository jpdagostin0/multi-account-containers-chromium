// Browser profile lookup, for requests that read the browser's own settings
// (theme.go, search.go).

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	extensionID = regexp.MustCompile(`^[a-p]{32}$`)
	// The value runs to the next " --" switch, so it may contain spaces.
	userDataDirArg = regexp.MustCompile(`--user-data-dir=(.+?)(?: --|$)`)
	// Native messaging passes the caller as the first argument.
	callerOrigin = regexp.MustCompile(`^chrome-extension://([a-p]{32})/?$`)
)

// userDataDirs are the browser data directories to search: the one the
// browser that started us was given with --user-data-dir if any (then that
// is the only one), else the default locations of every Chromium flavour.
func userDataDirs() []string {
	if d := parentUserDataDir(); d != "" {
		return []string{d}
	}
	var dirs []string
	if d, err := os.UserConfigDir(); err == nil {
		dirs = append(dirs, d)
	}
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		dirs = append(dirs, d)
	}
	return dirs
}

// profileDirs are the directories under root (up to four levels deep, for
// e.g. Google/Chrome/User Data/Default) that hold a browser profile.
func profileDirs(root string) []string {
	var out []string
	pattern := root
	for range 5 {
		matches, _ := filepath.Glob(filepath.Join(pattern, "Preferences"))
		for _, m := range matches {
			out = append(out, filepath.Dir(m))
		}
		pattern = filepath.Join(pattern, "*")
	}
	return out
}

// parentUserDataDir is the --user-data-dir of the browser that started us.
// Chromium rewrites its process title, so the arguments usually come
// space-separated rather than NUL-separated.
func parentUserDataDir() string {
	cmd, err := os.ReadFile("/proc/" + strconv.Itoa(os.Getppid()) + "/cmdline")
	if err != nil {
		return ""
	}
	if m := userDataDirArg.FindStringSubmatch(strings.ReplaceAll(string(cmd), "\x00", " ")); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func explicitUserDataDir() bool { return parentUserDataDir() != "" }

// allProfiles lists every profile directory, the caller's own profile first.
func allProfiles() []string {
	var all []string
	for _, root := range userDataDirs() {
		all = append(all, profileDirs(root)...)
	}
	if own := ownProfile(all); own != "" {
		out := []string{own}
		for _, p := range all {
			if p != own {
				out = append(out, p)
			}
		}
		return out
	}
	return all
}

// lastUsedProfile is the profile the browser under root used last
// (Local State's profile.last_used), "Default" if it doesn't say.
func lastUsedProfile(root string) string {
	var state struct {
		Profile struct {
			LastUsed string `json:"last_used"`
		} `json:"profile"`
	}
	name := "Default"
	if readJSON(root, "Local State", &state) && state.Profile.LastUsed != "" {
		name = state.Profile.LastUsed
	}
	p := filepath.Join(root, name)
	if _, err := os.Stat(filepath.Join(p, "Preferences")); err != nil {
		return ""
	}
	return p
}

// ownProfile is the profile the calling extension is installed in; with
// several, the one whose preferences were written last. The browser writes a
// newly installed extension to its preferences lazily, so until then it's the
// last-used profile of a browser started with --user-data-dir.
func ownProfile(profiles []string) string {
	if len(os.Args) < 2 {
		return ""
	}
	m := callerOrigin.FindStringSubmatch(os.Args[1])
	if m == nil {
		return ""
	}
	best, bestTime := "", time.Time{}
	for _, p := range profiles {
		if extensionPath(p, m[1]) == "" {
			continue
		}
		if st, err := os.Stat(filepath.Join(p, "Preferences")); err == nil && st.ModTime().After(bestTime) {
			best, bestTime = p, st.ModTime()
		}
	}
	if best == "" {
		if roots := userDataDirs(); len(roots) == 1 && explicitUserDataDir() {
			best = lastUsedProfile(roots[0])
		}
	}
	return best
}

// readJSON decodes a profile file into v; false if it's missing or invalid.
func readJSON(profile, name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(profile, name))
	return err == nil && json.Unmarshal(b, v) == nil
}

// extensionPath is where the profile's preferences say an extension lives:
// an absolute directory for unpacked extensions, "id/version" for packed ones.
// Chromium keeps extension settings in "Secure Preferences" (older versions
// and some forks in "Preferences").
func extensionPath(profile, id string) string {
	for _, name := range []string{"Secure Preferences", "Preferences"} {
		var prefs struct {
			Extensions struct {
				Settings map[string]struct {
					Path string `json:"path"`
				} `json:"settings"`
			} `json:"extensions"`
		}
		if !readJSON(profile, name, &prefs) {
			continue
		}
		if p := prefs.Extensions.Settings[id].Path; p != "" {
			if !filepath.IsAbs(p) {
				p = filepath.Join(profile, "Extensions", p)
			}
			return p
		}
	}
	return ""
}
