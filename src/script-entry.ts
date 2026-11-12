// Entry of the script-tag build. Importing this module starts analytics.
import { autoInit, installGlobal } from './script'

if (typeof window !== 'undefined') {
  installGlobal()
  autoInit(document.currentScript)
}
