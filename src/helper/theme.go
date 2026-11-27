// Browser theme lookup. Extensions can see which theme is installed
// (chrome.management) but not its colors, so the extension asks the helper
// to read the theme's manifest.json from the browser profile.

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var (
	extensionID = regexp.MustCompile(`^[a-p]{32}$`)
	versionRe   = regexp.MustCompile(`^[0-9][0-9.]*$`)
	// The value runs to the next " --" switch, so it may contain spaces.
	userDataDirArg = regexp.MustCompile(`--user-data-dir=(.+?)(?: --|$)`)
)

// userDataDirs are the browser data directories to search: the one the
// browser that started us was given with --user-data-dir, then the default
// locations of every Chromium flavour.
func userDataDirs() []string {
	var dirs []string
	// Chromium rewrites its process title, so the arguments usually come
	// space-separated rather than NUL-separated.
	if cmd, err := os.ReadFile("/proc/" + strconv.Itoa(os.Getppid()) + "/cmdline"); err == nil {
		if m := userDataDirArg.FindStringSubmatch(strings.ReplaceAll(string(cmd), "\x00", " ")); m != nil {
			dirs = append(dirs, strings.TrimSpace(m[1]))
		}
	}
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

// unpackedPath is where the profile's preferences say an extension lives:
// an absolute directory for unpacked extensions, "id/version" for packed ones.
// Chromium keeps extension settings in "Secure Preferences" (older versions
// and some forks in "Preferences").
func unpackedPath(profile, id string) string {
	for _, name := range []string{"Secure Preferences", "Preferences"} {
		b, err := os.ReadFile(filepath.Join(profile, name))
		if err != nil {
			continue
		}
		var prefs struct {
			Extensions struct {
				Settings map[string]struct {
					Path string `json:"path"`
				} `json:"settings"`
			} `json:"extensions"`
		}
		if json.Unmarshal(b, &prefs) != nil {
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

func readTheme(manifest string) json.RawMessage {
	b, err := os.ReadFile(manifest)
	if err != nil {
		return nil
	}
	var m struct {
		Theme json.RawMessage `json:"theme"`
	}
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m.Theme
}

// findTheme returns the "theme" object of extension id's manifest, or nil.
func findTheme(id, version string) json.RawMessage {
	if !extensionID.MatchString(id) || (version != "" && !versionRe.MatchString(version)) {
		return nil
	}
	for _, root := range userDataDirs() {
		for _, profile := range profileDirs(root) {
			if version != "" {
				matches, _ := filepath.Glob(filepath.Join(profile, "Extensions", id, version+"_*", "manifest.json"))
				for _, m := range matches {
					if t := readTheme(m); t != nil {
						return t
					}
				}
			}
			if dir := unpackedPath(profile, id); dir != "" {
				if t := readTheme(filepath.Join(dir, "manifest.json")); t != nil {
					return t
				}
			}
		}
	}
	return nil
}
