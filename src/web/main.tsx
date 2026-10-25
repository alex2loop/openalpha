import { render } from 'preact'

const ROOT_ID = 'root'

const root = document.getElementById(ROOT_ID)

if (root !== null) {
  render(null, root)
}
