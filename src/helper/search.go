// Default search engine lookup. chrome.search can run a query but doesn't say
// which engine it uses, so the extension asks the helper, which reads it from
// the profile's preferences (Chromium mirrors the default engine there).

package main

// SearchEngine is the part of Chromium's TemplateURL data the new tab page
// needs. URLs keep Chromium's {searchTerms}-style placeholders.
type SearchEngine struct {
	Name           string `json:"name"`
	Keyword        string `json:"keyword"`
	URL            string `json:"url"`
	SuggestionsURL string `json:"suggestionsUrl"`
	FaviconURL     string `json:"faviconUrl,omitempty"`
}

// findSearchEngine returns the default engine of the caller's profile, or nil
// when the profile still uses the built-in default (nothing mirrored).
func findSearchEngine() *SearchEngine {
	profile := ownProfile(allProfiles())
	if profile == "" {
		return nil
	}
	var prefs struct {
		Provider struct {
			Data struct {
				ShortName      string `json:"short_name"`
				Keyword        string `json:"keyword"`
				URL            string `json:"url"`
				SuggestionsURL string `json:"suggestions_url"`
				FaviconURL     string `json:"favicon_url"`
			} `json:"mirrored_template_url_data"`
		} `json:"default_search_provider_data"`
	}
	if !readJSON(profile, "Preferences", &prefs) || prefs.Provider.Data.URL == "" {
		return nil
	}
	d := prefs.Provider.Data
	return &SearchEngine{Name: d.ShortName, Keyword: d.Keyword, URL: d.URL, SuggestionsURL: d.SuggestionsURL, FaviconURL: d.FaviconURL}
}
