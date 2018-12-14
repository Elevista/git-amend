#!/usr/bin/env node
const moment = require('moment')
const util = require('util')
const format = 'ddd MMM DD HH:mm YYYY Z'
const { MultiSelect, Select, Snippet } = require('enquirer')
const c = require('ansi-colors')
const exec = util.promisify(require('child_process').exec)

// %H: commit hash
// %h: abbreviated commit hash
// %an: author name
// %ae: author email
// %cd: committer date (format respects --date= option)
// %s: subject
// %n: newline
;(async function () {
  if ((await exec('git status -s -uno')).stdout.length) {
    console.log(c.red.bold(`You have uncommitted changes`))
    return
  }

  let { stdout } = await exec('git log --format="%H%n%h%n%an%n%ae%n%cd%n%s%n%n" -10')
  const ref = {}
  let commits = stdout.split('\n\n').map(x => {
    const [hash, hs, name, email, date, subject] = x.trim().split('\n')
    return { hash, hs, name, email, date: moment(date, format), subject }
  }).filter(x => x.hash)
  commits.forEach(x => { ref[x.hash] = x })

  const selectedCommits = await new MultiSelect({
    name: 'value',
    message: 'Select commits to change',
    footer: 'Please select at least one',
    limit: 10,
    validate (v) { return !!v.length },
    result (names) {
      return Object.values(this.map(names))
    },
    choices: commits.map(({ hash, hs, name, date, subject }) => {
      return {
        name: `${c.yellow(`(${hs})`)}${c.bold(date.format('YYYY-MM-DD HH:mm'))}`,
        hint: `${c.green.bold(name)} ${subject}`,
        value: hash }
    })
  }).run()
  // if (!selectedCommits.length) return

  const choices = [ 'subtract', 'add']
  if (selectedCommits.length === 1) choices.push('set')
  const method = await new Select({
    name: 'method',
    message: 'Select moment manipulate method',
    choices
  }).run()

  const fn = method === 'set' ? 'moment' : 'moment.duration'
  const message = method === 'set' ? 'Time unit' : `Duration to ${method}`
  const values = method === 'set' ? moment().toObject() : {
    minutes: 0,
    hours: 0,
    days: 0,
    months: 0,
    years: 0
  }
  const days = method === 'set' ? 'date' : 'days'
  Object.keys(values).forEach(key => { values[key] += '' })

  let fields = Object.keys(values).map(name => { return { name, validate (v) { return !isNaN(v) } } })
  let { values: timeUnit } = await new Snippet({
    name: 'Time unit',
    message,
    fields,
    format () { return '' },
    values,
    template: `${fn}({
  minutes: ${c.yellow(`\${minutes}`)},
  hours: ${c.yellow(`\${hours}`)},
  ${days}: ${c.yellow(`\${${days}}`)},
  months: ${c.yellow(`\${months}`)},
  years: ${c.yellow(`\${years}`)}
})`
  }).run()

  for (let { hash, date } of selectedCommits.map(x => ref[x])) {
    const from = date.format('YYYY-MM-DD HH:mm')
    let m = method === 'set' ? moment(timeUnit) : date[method](timeUnit)
    console.log(`${c.bold.cyan(from)} -> ${c.bold.green(m.format('YYYY-MM-DD HH:mm'))} `)
    const { stdout } = await exec(
      `git filter-branch -f --env-filter \\
        'if [ $GIT_COMMIT = ${hash} ]
         then
          export GIT_AUTHOR_DATE="${m.format(format)}"
          export GIT_COMMITTER_DATE="${m.format(format)}"
        fi'`
    )
    console.log(stdout)
  }
  console.log(c.yellow.bold('Done!'))
})()
