/** Static export: the test server serves the files in out/. */
export default {
  output: 'export',
  // This example lives inside the library repository; build it as its own project.
  turbopack: { root: import.meta.dirname },
}
