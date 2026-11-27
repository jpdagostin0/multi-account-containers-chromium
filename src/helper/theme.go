// Browser theme lookup. Extensions can see which theme is installed
// (chrome.management) but not its colors, so the extension asks the helper
// to read the theme's manifest.json from the browser profile.

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
)

var versionRe = regexp.MustCompile(`^[0-9][0-9.]*$`)

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
	for _, profile := range allProfiles() {
		if version != "" {
			matches, _ := filepath.Glob(filepath.Join(profile, "Extensions", id, version+"_*", "manifest.json"))
			for _, m := range matches {
				if t := readTheme(m); t != nil {
					return t
				}
			}
		}
		if dir := extensionPath(profile, id); dir != "" {
			if t := readTheme(filepath.Join(dir, "manifest.json")); t != nil {
				return t
			}
		}
	}
	return nil
}
