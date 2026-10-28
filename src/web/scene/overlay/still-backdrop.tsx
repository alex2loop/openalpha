import { useLayoutEffect } from 'preact/hooks'

import { dropStill, keepFloorPlanUnlessKept, officeStill } from '@/web/scene/overlay/still'

import './still-backdrop.css'

/** Info only's backdrop: the office as last seen, still and blurred, for the panel's glass to show.
 *  Nothing runs behind it; leaving Info only lets the picture go. */
export function StillBackdrop() {
  useLayoutEffect(() => {
    keepFloorPlanUnlessKept()

    return dropStill
  }, [])

  const still = officeStill.value

  return still === undefined ? null : (
    <img class="still-backdrop" src={still} alt="" aria-hidden="true" />
  )
}
