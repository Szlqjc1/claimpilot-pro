// Static-asset module declarations for CI.
//
// `next-env.d.ts` is gitignored and only exists after `next dev` / `next build` has run. CI runs `tsc --noEmit`
// before `next build`, so at that point nothing declares `*.png`, and every `import mark from "@/assets/x.png"`
// fails with TS2307 even though the file is committed.
//
// Referencing Next's own declarations here keeps CI honest without committing the generated file.
/// <reference types="next/image-types/global" />
