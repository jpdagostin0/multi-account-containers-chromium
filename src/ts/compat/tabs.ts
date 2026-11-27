/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.tabs with Firefox's cookieStoreId: reported on every Tab, honoured
// by tabs.create and tabs.query.

import type { Tabs } from "webextension-polyfill";
import { DEFAULT } from "../lib/constants";
import type { Listener } from "../lib/events";
import { iso } from "./background";
import { base } from "./base";
import { contextualIdentities } from "./identities";
import { overlay, type AnyRecord } from "./overlay";
import { chromeUrl, firefoxUrl, isNetworkUrl } from "./urls";

export type Tab = Tabs.Tab & { pendingUrl?: string; groupId?: number };
type QueryInfo = Tabs.QueryQueryInfoType & { cookieStoreId?: string | string[]; hidden?: boolean; openerTabId?: number };
type CreateProps = Tabs.CreateCreatePropertiesType & AnyRecord;

export function augment<T extends Tab | undefined>(tab: T): T {
  if (!tab || typeof tab !== "object") return tab;
  tab.cookieStoreId = iso().get(tab.id!);
  // Firefox always reports a URL; Chromium leaves it empty while loading.
  tab.url = firefoxUrl(tab.url || tab.pendingUrl || "about:blank");
  if (tab.groupId === undefined) tab.groupId = -1;
  return tab;
}
const augmentAll = <T extends Tab | Tab[]>(tabs: T): T =>
  (Array.isArray(tabs) ? tabs.map(augment) : augment(tabs)) as T;

function wrapTabEvent(event: AnyRecord, tabArgIndex: number) {
  const map = new Map<Listener, Listener>();
  return {
    addListener(fn: Listener, ...rest: unknown[]) {
      const wrapped = (...args: unknown[]) => {
        augment(args[tabArgIndex] as Tab);
        return fn(...args);
      };
      map.set(fn, wrapped);
      event.addListener(wrapped, ...rest);
    },
    removeListener(fn: Listener) {
      const wrapped = map.get(fn);
      if (wrapped) event.removeListener(wrapped);
      map.delete(fn);
    },
    hasListener: (fn: Listener) => map.has(fn),
  };
}

const overrides = {
  async query(queryInfo: QueryInfo = {}): Promise<Tab[]> {
    const { cookieStoreId, hidden, openerTabId, ...q } = queryInfo;
    if (hidden === true) return [];
    let result = augmentAll(await base.tabs.query(q) as Tab[]);
    if (openerTabId !== undefined) result = result.filter((t) => t.openerTabId === openerTabId);
    if (cookieStoreId !== undefined) {
      const stores = new Set(Array.isArray(cookieStoreId) ? cookieStoreId : [cookieStoreId]);
      result = result.filter((t) => stores.has(t.cookieStoreId!));
    }
    return result;
  },
  async get(tabId: number) {
    return augment(await base.tabs.get(tabId) as Tab);
  },
  async getCurrent() {
    return augment(await base.tabs.getCurrent() as Tab);
  },
  async create(props: CreateProps = {}) {
    const { cookieStoreId, discarded, openInReaderMode, title, muted, ...p } = props;
    let csid: string | undefined = cookieStoreId;
    // Firefox: a tab opened with an opener inherits the opener's container.
    if (!csid && p.openerTabId !== undefined && p.openerTabId !== null) csid = iso().get(p.openerTabId);
    csid = csid || DEFAULT;
    if (csid !== DEFAULT) await contextualIdentities.get(csid);
    p.url = chromeUrl(p.url);
    // The tab's first request may go out before tabs.create resolves: the
    // isolation engine binds it by URL in its (synchronous) onBeforeRequest.
    const ticket = isNetworkUrl(p.url) ? iso().expect(p.url, csid) : null;
    try {
      const tab = await base.tabs.create(p) as Tab;
      iso().setTab(tab.id!, csid);
      return augment(tab);
    } finally {
      if (ticket) iso().unexpect(ticket);
    }
  },
  async update(...args: [number, AnyRecord] | [AnyRecord]) {
    const withId = typeof args[0] === "number";
    const { loadReplace, successorTabId, discarded, ...props } = (withId ? args[1] : args[0]) as AnyRecord;
    if (props.url !== undefined) props.url = chromeUrl(props.url);
    const tab = withId ? await base.tabs.update(args[0] as number, props) : await base.tabs.update(props);
    return augment(tab as Tab);
  },
  async move(ids: number | number[], props: Tabs.MoveMovePropertiesType) {
    return augmentAll(await base.tabs.move(ids as number, props) as Tab | Tab[]);
  },
  async duplicate(tabId: number, props?: Tabs.DuplicateDuplicatePropertiesType) {
    return augment(await base.tabs.duplicate(tabId, props) as Tab);
  },
  group(options: chrome.tabs.GroupOptions): Promise<number> {
    if (!chrome.tabs.group) return Promise.resolve(-1);
    return new Promise((resolve, reject) => chrome.tabs.group(options, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    }));
  },
  onCreated: wrapTabEvent(base.tabs.onCreated, 0),
  onUpdated: wrapTabEvent(base.tabs.onUpdated, 2),
};

export const tabs = overlay(base.tabs, overrides);
