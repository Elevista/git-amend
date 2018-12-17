const win32 = process.platform === 'win32'
const { execSync } = require('child_process')
const escapeRegex = win32 ? [/([%()^])/g, '^$1'] : [/(["\\;])/g, '\\$1']
const c = require('ansi-colors')
const joinTpl = (str, exp) => str.map((x, i) => x + (exp[i] || '')).join('')
const joinChar = win32 ? '\n' : ';'

const escape = function (str, ...exp) {
  return str.map((x, i) => {
    let ret = `${exp[i] || ''}`.replace(...escapeRegex)
    return x + ret
  }).join('')
}
const makeEcho = str => `(${str.split('\n').map(x => escape`echo ${x}`).join(joinChar)})`
const exec = (...args) => execSync(escape(...args), { stdio: ['pipe', 'pipe', 'pipe'] }).toString()

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
