/// <reference types="vite/client" />

/**
 * `tsc` type-checks the plain `.ts` modules and treats every SFC as an opaque
 * component. Single-file components are compiled (and syntax-checked) by
 * Vite; the logic that carries the interview state lives in testable `.ts`
 * modules on purpose.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
