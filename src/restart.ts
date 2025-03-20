import { showHUD, showToast, Toast } from '@raycast/api'
import { runAppleScript } from '@raycast/utils'

import { checkHammerspoonInstallation } from './utils/installation'

export default async function main() {
  const isInstalled = await checkHammerspoonInstallation()

  if (!isInstalled) {
    return
  }

  const output = await runAppleScript(`
    try
      tell application "Hammerspoon"
        execute lua code "hs.relaunch()"
      end tell
    on error errMsg number errNum
      if errNum is -609 then
        -- Expected to fail here because the relaunch
        -- check again in two seconds if it started again
        delay 1.2
        if application "Hammerspoon" is running then
          return true
        else
          return false
        end if
      else
        -- Propagate other errors
        error errMsg number errNum
      end if
    end try
  `)

  if (output === 'true') {
    await showHUD('🔨 Hammerspoon was restarted')
  } else {
    await showToast({
      style: Toast.Style.Failure,
      title: '🔨 Hammerspoon was restarted but we could not detect if it started again. Please check manually.'
    })
  }
}
