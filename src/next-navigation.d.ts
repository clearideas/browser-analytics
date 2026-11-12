// Minimal typing for the two Next.js hooks used by src/next.ts, so the library builds
// without Next installed. Not shipped: consumers use Next's own types.
declare module 'next/navigation' {
  export function usePathname(): string | null
  export function useSearchParams(): { toString(): string } | null
}
