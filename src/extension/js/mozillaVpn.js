const MozillaVPN = {

  handleMozillaCtaClick(buttonIdentifier) {
    browser.tabs.create({
      url: MozillaVPN.attachUtmParameters("https://www.mozilla.org/products/vpn", buttonIdentifier),
    });
  },

  getRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  proxyIsDisabled(proxy) {
    return (
      // Mozilla VPN proxy is disabled, last location data is stored
      (proxy.mozProxyEnabled === undefined && proxy.countryCode !== undefined && proxy.cityName !== undefined) ||
      // Mozilla VPN proxy is enabled but Mozilla VPN is not connected
      proxy.mozProxyEnabled !== undefined
    );
  },

  attachUtmParameters(baseUrl, utmContent) {
    const url = new URL(baseUrl);
    const utmParameters = {
      utm_source: "multi.account.containers",
      utm_medium: "mac-browser-addon",
      utm_content: utmContent,
      utm_campaign: "vpn-better-together",
    };

    for (const param in utmParameters) {
      url.searchParams.append(param, utmParameters[param]);
    }
    return url.href;
  },

  async getProxies(identities) {
    const proxies = {};
    const mozillaVpnInstalled = await browser.runtime.sendMessage({ method: "MozillaVPN_getInstallationStatus" });

    if (mozillaVpnInstalled) {
      for (const identity of identities) {
        try {
          const proxy = await proxifiedContainers.retrieve(identity.cookieStoreId);
          proxies[identity.cookieStoreId] = proxy;
        } catch {
          proxies[identity.cookieStoreId] = {};
        }
      }
    }
    return proxies;
  },

  getMozillaProxyInfoObj() {
    return {
      countryCode: undefined,
      cityName: undefined,
      mozProxyEnabled: undefined
    };
  },

  async bothPermissionsEnabled() {
    return await browser.permissions.contains({ permissions: ["proxy", "nativeMessaging"] });
  },


  async getProxyWarnings(proxyObj) {
    if (!proxyObj) {
      return "";
    }

    const { proxy } = proxyObj;

    if (typeof(proxy) === "undefined") {
      return "";
    }

    const mozillaVpnConnected = await browser.runtime.sendMessage({ method: "MozillaVPN_getConnectionStatus" });
    if (typeof(proxy.mozProxyEnabled) !== "undefined" && !mozillaVpnConnected) {
      return "proxy-unavailable";
    }
  },

  async getFlag(proxyObj) {
    const flag = {
      imgCode: "default",
      elemClasses: "display-none",
      imgAlt: "",
    };

    if (!proxyObj) {
      return flag;
    }

    const { proxy } = proxyObj;
    const mozillaVpnInstalled = await browser.runtime.sendMessage({ method: "MozillaVPN_getInstallationStatus" });
    if (typeof(proxy) === "undefined"  || !mozillaVpnInstalled) {
      return flag;
    }

    const mozillaVpnConnected = await browser.runtime.sendMessage({ method: "MozillaVPN_getConnectionStatus" });
    if (mozillaVpnInstalled && typeof(proxy.cityName) !== "undefined") {
      flag.imgCode = proxy.countryCode.toUpperCase();
      flag.imgAlt = proxy.cityName;
      flag.elemClasses = typeof(proxy.mozProxyEnabled) === "undefined" || !mozillaVpnConnected ? "proxy-disabled" : "";
    }

    return flag;
  },

  getProxy(countryCode, cityName, mozProxyEnabled, mozillaVpnServers) {
    const selectedServerCountry = mozillaVpnServers.find(({code}) => code === countryCode);
    const selectedServerCity = selectedServerCountry.cities.find(({name}) => name === cityName);
    const proxyServer = this.pickServerBasedOnWeight(selectedServerCity.servers);
    return proxifiedContainers.parseProxy(
      this.makeProxyString(proxyServer.socksName),
      {
        countryCode: countryCode,
        cityName: cityName,
        mozProxyEnabled,
      }
    );
  },

  makeProxyString(socksName) {
    return `socks://${socksName}.mullvad.net:1080`;
  },

  async pickRandomLocation() {
    const { mozillaVpnServers } = await browser.storage.local.get("mozillaVpnServers");
    const randomInteger = this.getRandomInteger(0, mozillaVpnServers.length - 1);
    const randomServerCountry = mozillaVpnServers[randomInteger];

    return {
      randomServerCountryCode: randomServerCountry.code,
      randomServerCityName: randomServerCountry.cities[0].name,
    };

  },

  pickServerBasedOnWeight(serverList) {
    const filteredServerList = serverList.filter(server => typeof(server.socksName) !== "undefined" && server.socksName !== "");

    const sumWeight = filteredServerList.reduce((sum, { weight }) => sum + weight, 0);
    let randomInteger = this.getRandomInteger(0, sumWeight);

    let nextServer = {};
    for (const server of filteredServerList) {
      if (server.weight >= randomInteger) {
        return nextServer = server;
      }
      randomInteger = (randomInteger - server.weight);
    }
    return nextServer;
  },
};

window.MozillaVPN = MozillaVPN;
