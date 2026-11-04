import { useEffect, useRef, useState } from 'react';
export interface BrowseRoute {
  file: string | null;
  path: string[];
}
const initial: BrowseRoute = { file: null, path: [] };
export function useWorkspaceNavigation(canLeave: () => boolean) {
  const [route, setRoute] = useState<BrowseRoute>(initial);
  const guard = useRef(canLeave),
    position = useRef(0),
    restoring = useRef(false);
  useEffect(() => {
    guard.current = canLeave;
  });
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, datRoute: { route: initial, index: 0 } },
      '',
    );
    const pop = (event: PopStateEvent) => {
      const state = event.state?.datRoute;
      if (!state || !state.route || !Array.isArray(state.route.path)) return;
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      if (!guard.current()) {
        restoring.current = true;
        window.history.go(position.current - state.index);
        return;
      }
      position.current = state.index;
      setRoute(state.route);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function navigate(next: BrowseRoute, replace = false) {
    if (!guard.current()) return false;
    const index = replace ? position.current : position.current + 1;
    const url = next.file
      ? '#/files/' + [next.file, ...next.path].map(encodeURIComponent).join('/')
      : '#/files';
    window.history[replace ? 'replaceState' : 'pushState'](
      { ...window.history.state, datRoute: { route: next, index } },
      '',
      url,
    );
    position.current = index;
    setRoute(next);
    return true;
  }
  return { route, navigate };
}
