import { instagramAdapter, facebookAdapter } from "./metaPublisher.js";
import { aukroAdapter } from "./aukroPublisher.js";
import { sasheAdapter } from "./sashePublisher.js";
import {
  pinterestAdapter,
  tiktokAdapter,
  threadsAdapter,
  xAdapter,
  etsyAdapter,
} from "./socialStubs.js";

export const PUBLISHER_REGISTRY = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  aukro: aukroAdapter,
  sashe: sasheAdapter,
  pinterest: pinterestAdapter,
  tiktok: tiktokAdapter,
  threads: threadsAdapter,
  x: xAdapter,
  etsy: etsyAdapter,
};

export function getAdapter(key) {
  return PUBLISHER_REGISTRY[key] || null;
}

export function listAdapters() {
  return Object.values(PUBLISHER_REGISTRY);
}
