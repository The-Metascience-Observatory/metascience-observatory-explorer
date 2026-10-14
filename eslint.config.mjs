import next from "eslint-config-next";

/**
 * Next 16 removed `next lint`, so ESLint is driven directly (`eslint .`).
 *
 * eslint-config-next 16 ships a native flat config, which replaces the
 * FlatCompat shim this file used to need. Its array already bundles what the
 * old `compat.extends("next/core-web-vitals", "next/typescript")` pulled in.
 *
 * `next lint` used to supply the ignore list implicitly; driving ESLint
 * directly means stating it here, or `eslint .` walks the build output and the
 * multi-terabyte data directory.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "journals_data/**",
      "SciSciNet/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    // eslint-config-next 16 enables React Compiler rules that eslint-config-next
    // 15 did not. They flag 28 pre-existing patterns across 11 files — real
    // code-quality signals (setState inside effects, components declared inside
    // components, prop mutation), but a refactor in their own right rather than
    // part of a dependency upgrade. Kept as warnings so the signal stays visible
    // instead of being switched off and forgotten.
    name: "project/react-compiler-rules-pending-refactor",
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default eslintConfig;
