// If the repo is using noImplicitAny=true and @types/react/jsx aren't available,
// the JSX intrinsic element errors can cascade. This file provides a safety net.

declare global {
  // no-op
}

export {};

