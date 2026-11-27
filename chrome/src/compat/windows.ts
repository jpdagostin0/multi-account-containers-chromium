/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.windows with cookieStoreId support in windows.create.

import type { Windows } from "webextension-polyfill";
import { DEFAULT } from "../lib/constants";
import { iso } from "./background";
import { base } from "./base";
import { overlay, type AnyRecord } from "./overlay";
import { augment, type Tab } from "./tabs";
import { chromeUrl, isNetworkUrl } from "./urls";

type CreateData = Windows.CreateCreateDataType & AnyRecord;

const augmentWindow = (w: Windows.Window) => {
  if (w && Array.isArray(w.tabs)) w.tabs.forEach((t) => augment(t as Tab));
  return w;
};

const overrides = {
  async create(data: CreateData = {}) {
    const { cookieStoreId: csid, titlePreface, allowScriptsToClose, ...d } = data;
    if (typeof d.url === "string") d.url = chromeUrl(d.url);
    if (!csid || csid === DEFAULT) return augmentWindow(await base.windows.create(d));
    const ticket = isNetworkUrl(d.url) ? iso().expect(d.url, csid) : null;
    try {
      const w = await base.windows.create(d);
      const first = w.tabs && w.tabs[0];
      if (first) iso().setTab(first.id!, csid);
      return augmentWindow(await base.windows.get(w.id!, { populate: true }));
    } finally {
      if (ticket) iso().unexpect(ticket);
    }
  },
  async get(id: number, info?: Windows.GetInfo) { return augmentWindow(await base.windows.get(id, info)); },
  async getCurrent(info?: Windows.GetInfo) { return augmentWindow(await base.windows.getCurrent(info)); },
  async getLastFocused(info?: Windows.GetInfo) { return augmentWindow(await base.windows.getLastFocused(info)); },
  async getAll(info?: Windows.GetAllGetInfoType) { return (await base.windows.getAll(info)).map(augmentWindow); },
};

export const windows = overlay(base.windows, overrides);
