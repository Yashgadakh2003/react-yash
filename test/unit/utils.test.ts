/* eslint-env jest */
import { getURL } from 'next/dist/shared/lib/utils'

describe('getURL', () => {
  // Convenience function so tests can be aligned neatly
  // and easy to eyeball
  const check = (url: string, pathname: string) => {
    global.window.location = new URL(url)
    const rootRelativeUrl = getURL()
    expect(rootRelativeUrl).toBe(pathname)
  }

  beforeAll(() => {
    global.window = {}
  })

  afterAll(() => {
    delete global.window
  })

  it('should get valid root path in HTTP', () => {
    check('http://example.com:3210/', '/')
  })

  it('should get converted valid root path from invalid URL in HTTP', () => {
    check('http://example.com:3210//', '/')
  })

  it('should get valid path in HTTP', () => {
    check(
      'http://example.com:3210/someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
  })

  it('should get converted valid path from invalid URL in HTTP', () => {
    check(
      'http://example.com:3210//someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
  })

  it('should get valid root path in HTTPS', () => {
    check('https://example.com:3210/', '/')
  })

  it('should get converted valid root path from invalid URL in HTTPS', () => {
    check('https://example.com:3210//', '/')
  })

  it('should get valid path in HTTPS', () => {
    check(
      'https://example.com:3210/someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
  })

  it('should get converted valid path from invalid URL in HTTPS', () => {
    check(
      'https://example.com:3210//someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
  })

  it('should get valid path on special protocol', () => {
    check(
      'ionic://localhost/someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
    check('file:///someA/pathB?fooC=barD#hashE', '/someA/pathB?fooC=barD#hashE')
  })

  it('should get valid path from invalid URL on special protocol', () => {
    check(
      'ionic://localhost//someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
    check(
      'file:////someA/pathB?fooC=barD#hashE',
      '/someA/pathB?fooC=barD#hashE'
    )
  })
})
