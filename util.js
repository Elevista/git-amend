const win32 = process.platform === 'win32'
const { execSync } = require('child_process')
const escapeRegex = win32 ? [/([%()^])/g, '^$1'] : [/(["\\])/g, '\\$1']
const lineWrap = win32 ? '()' : '""'

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
module.exports = { exec, escape, makeEcho }
