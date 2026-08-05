import React from "react";
import RecentsScreen from "./RecentsScreen";

/**
 * Dedicated Search tab — search-first experience (no recents list shown,
 * keyboard auto-focus, search-appropriate empty state).
 */
export default function SearchScreen() {
  return <RecentsScreen variant="search" />;
}
