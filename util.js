const win32 = process.platform === 'win32'
const { execSync } = require('child_process')
const escapeRegex = win32 ? [/([%()^])/g, '^$1'] : [/(["\\])/g, '\\$1']
const lineWrap = win32 ? '()' : '""'
const c = require('ansi-colors')
const joinTpl = (str, exp) => str.map((x, i) => x + (exp[i] || '')).join('')

const escape = function (str, ...exp) {
  let ret = str.map((x, i) => {
    let ret = (exp[i] || '').replace(...escapeRegex)
    if (!win32) ret = /\n/.test(ret) ? lineWrap[0] + ret + lineWrap[1] : ret
    return x + ret
  }).join('')
  return win32 && /\n/.test(ret) ? `(${ret})` : ret
}
const makeEcho = win32 ? str => escape`${str.split('\n').map(x => `echo ${x}`).join('\n')}` : str => escape`echo ${str}`
const exec = (...args) => execSync(escape(...args)).toString()

const colors = {
  println (str, ...exp) {
    const input = typeof str === 'string' ? str : joinTpl(str, exp)
    console.log(this._color ? this._color(input) : input)
  }
}
const define = name => Reflect.defineProperty(colors, name, {
  get () {
    let ret = (str, ...exp) => {
      if (typeof str === 'string') return ret._color(str)
      else return ret._color(joinTpl(str, exp))
    }
    Reflect.setPrototypeOf(ret, colors)
    ret._color = this._color ? this._color[name] : c[name]
    return ret
  }
})
;[].concat(...Object.values(c.keys)).forEach(define)

module.exports = { exec, makeEcho, colors }
