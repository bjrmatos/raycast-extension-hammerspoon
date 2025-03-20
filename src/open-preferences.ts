import { execSync } from 'node:child_process'
import { closeMainWindow } from '@raycast/api'
import { checkHammerspoonInstallation } from './utils/installation'

// TODO: Put this into preferences
// this should likely search in /usr/local by default, because it is the default of the cli install
// https://www.hammerspoon.org/docs/hs.ipc.html#cliInstall
// however if user installs from homebrew the cli is already there, so we should check that
// path automatically too
const HS_CLI_PATH = '/opt/homebrew/bin/hs'

export default async function main() {
  const isInstalled = await checkHammerspoonInstallation()

  if (!isInstalled) {
    return
  }

  // NOTE: we should likely also provide some better user feedback for when the cli `hs` is missing,
  // which comes pre-installed with homebrew or can be installed manually
  // (https://www.hammerspoon.org/docs/hs.ipc.html#cliInstall)
  // or the `hs.ipc`(https://www.hammerspoon.org/docs/hs.ipc.html) is not loaded in
  // the user configuration file.
  execSync(`${HS_CLI_PATH} -c 'hs.openPreferences()'`, {
    encoding: 'utf-8'
  })

  await closeMainWindow()
}
