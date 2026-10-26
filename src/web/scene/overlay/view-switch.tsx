import { SCENE_VIEWS, type SceneView, sceneView, setSceneView } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'
import { Segmented } from '@/web/ui/kit/segmented'

import './view-switch.css'

const VIEW_LABELS = Object.freeze({
  '2d': 'ui.office.scene.mode2d',
  '3d': 'ui.office.scene.mode3d',
} as const satisfies Record<SceneView, string>)

let hasWebgl: boolean | undefined

/** The header's 2D or 3D choice; 3D is off on a device that cannot draw it. */
export function ViewSwitch() {
  const canDraw3d = isWebglAvailable()

  return (
    <Segmented
      className="view-switch"
      label={tr('ui.office.scene.view')}
      title={tr('ui.office.scene.viewTip')}
      value={sceneView.value}
      options={SCENE_VIEWS.map((value) => ({
        value,
        label: tr(VIEW_LABELS[value]),
        ...(value === '3d' && !canDraw3d
          ? { isDisabled: true, title: tr('ui.office.scene.no3d') }
          : {}),
      }))}
      onChange={setSceneView}
    />
  )
}

// One throwaway context answers once; it is released at once so it holds no GPU memory.
function isWebglAvailable(): boolean {
  if (hasWebgl !== undefined) {
    return hasWebgl
  }

  try {
    const context = document.createElement('canvas').getContext('webgl2')

    hasWebgl = context !== null
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    hasWebgl = false
  }

  return hasWebgl
}
