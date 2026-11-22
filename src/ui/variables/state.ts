import type { SortBy, SortDir } from '../../varModel';

export const ui = {
  disposers: [] as (() => void)[],
  expandedIds: new Set<string>(),
  toolbarState: { query: '', sortBy: 'name' as SortBy, dir: 'asc' as SortDir },
  pendingFocusId: null as string | null,
  searchHadFocus: false,
  searchCursorPos: 0,
  liveValueRefs: new Map<string, HTMLElement>(),
  rowElRefs: new Map<string, HTMLElement>(),
  overflowMenuEl: null as HTMLDivElement | null,
  rerender: () => {},
};
