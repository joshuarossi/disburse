import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function ScrollToHash() {
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return

    const id = decodeURIComponent(hash.replace('#', ''))
    let attempts = 0

    const scrollToElement = () => {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      attempts += 1
      if (attempts < 8) {
        window.setTimeout(scrollToElement, 150)
      }
    }

    scrollToElement()
  }, [hash])

  return null
}
