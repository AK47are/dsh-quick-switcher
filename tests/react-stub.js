/* Minimal React surface for the module contract test. Node cannot resolve the
 * external React, so the test bundles the real manifest with this stub. The
 * hooks are only called while rendering, which the contract test does not do. */

export const Fragment = Symbol.for("react.fragment");

export function createElement(type, props, ...children) {
  return { type, props, children };
}

export function useState(value) {
  return [value, () => {}];
}

export function useEffect() {}

export function useLayoutEffect() {}

export function useMemo(callback) {
  return callback();
}

export function useRef(value) {
  return { current: value };
}

export function useReducer(value) {
  return [value, () => {}];
}

export function useCallback(callback) {
  return callback;
}

export function useSyncExternalStore(_subscribe, getSnapshot) {
  return getSnapshot();
}

export function useId() {
  return "test-id";
}

export default {
  Fragment,
  createElement,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useReducer,
  useCallback,
  useSyncExternalStore,
  useId,
};
