#!/usr/bin/env node
const moment = require('moment')
const util = require('util')
const [, , ...args] = process.argv
const format = 'ddd MMM DD HH:mm YYYY Z'

const exec = util.promisify(require('child_process').exec)

async function asyncExec () {
  let m
  if (args[0] === 'now') {
    m = moment()
    args.shift()
  } else {
    let { stdout } = await exec('git log -1 --format=%cd')
    m = moment(stdout, format)
  }
  if ('add,subtract'.includes(args[0])) {
    let [method, ...params] = args
    m = m[method](...params)
  } else m = moment(...args)

  console.log(m.format('YYYY-MM-DD A hh:mm'))
  const date = m.format(format)
  console.log(`git commit --amend --date="${date}" --no-edit`, { env: { 'GIT_COMMITTER_DATE': date } })
  const { stdout } = await exec(`git commit --amend --date="${date}" --no-edit`, { env: { 'GIT_COMMITTER_DATE': date } })
  console.log(stdout)
}

asyncExec()
