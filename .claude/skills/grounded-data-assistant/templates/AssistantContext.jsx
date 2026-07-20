'use client';

/**
 * STARTER STUB — page/screen context for the assistant, so it understands
 * "this", "here", "right now", and "my". Generic by design: ANY screen can
 * register what the user is viewing, so the assistant works across the whole app.
 *
 * Copy into your frontend (e.g. contexts/AssistantContext.jsx). Wrap your app in
 * <AssistantProvider> and call useRegisterAssistantContext(...) from each page.
 * Send the registered pageContext to the backend runner with each question.
 */
import PropTypes from 'prop-types';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AssistantContext = createContext({ pageContext: null, setPageContext: () => {} });

export function AssistantProvider({ children }) {
  const [pageContext, setPageContext] = useState(null);
  const value = useMemo(() => ({ pageContext, setPageContext }), [pageContext]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

AssistantProvider.propTypes = { children: PropTypes.node };

export function useAssistant() {
  return useContext(AssistantContext);
}

/**
 * Register what the user is currently viewing. Call from a page/view:
 *   useRegisterAssistantContext({
 *     screen: 'item',
 *     entity: { type: 'item', id },
 *     summary: 'Item #12 — Acme order',
 *     details: { status: 'draft', total: '$1,200' }, // on-screen figures, CONTEXT ONLY
 *   });
 * Pass a falsy value to clear. Re-registers when the context changes; clears on unmount.
 */
export function useRegisterAssistantContext(ctx) {
  const { setPageContext } = useContext(AssistantContext);
  const json = ctx ? JSON.stringify(ctx) : '';
  useEffect(() => {
    setPageContext(json ? JSON.parse(json) : null);
    return () => setPageContext(null);
  }, [json, setPageContext]);
}
