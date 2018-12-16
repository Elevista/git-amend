#!/usr/bin/env node
const moment = require('moment')
const format = 'ddd MMM DD HH:mm YYYY Z'
const { MultiSelect, Select, Snippet } = require('enquirer')
const c = require('ansi-colors')
const { execSync } = require('child_process')

// %H: commit hash
// %h: abbreviated commit hash
// %an: author name
// %ae: author email
// %ad: author date
// %cn: committer name
// %ce: committer email
// %cd: committer date
// %s: subject
// %n: newline

const escape = process.platform === 'win32' ? [/([%)])/g, '^$1'] : [/(["])/g, '\\$1']

;(async function () {
  if (execSync('git status -s -uno').toString().length) {
    console.log(c.red.bold(`You have uncommitted changes`))
    return
  }
  try { execSync(`git rebase --abort -q`) } catch (e) {}

  let stdout = execSync('git log --format="%H%n%h%n%an%n%ae%n%ad%n%cn%n%ce%n%cd %n%s%n" -10').toString().replace(...escape)
  const ref = {}
  let commits = stdout.split('\n\n').map((x, idx) => {
    const [hash, hs, name, email, date, cname, cemail, cdate, subject] = x.trim().split('\n')
    return { hash, hs, subject, name, email, date: moment(date, format), cname, cemail, cdate: moment(cdate, format), idx, rebase: 'pick' }
  }).filter(x => x.hash)
  commits.forEach(x => { ref[x.hash] = x })

  const selectedCommits = (await new MultiSelect({
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
  }).run()).map(x => ref[x])

  commits.reverse()
  selectedCommits.reverse()

  selectedCommits.forEach(x => { x.rebase = 'edit' })
  while (commits[0] && (commits[0].rebase === 'pick')) commits.shift()
  const rebaseString = commits.map(({ hs, subject, rebase }) => `${rebase} ${hs} ${subject}`).join('\n').replace(...escape)
  process.env['GIT_SEQUENCE_EDITOR'] = process.platform.win32
    ? `(${rebaseString.split('\n').map(x => 'echo ' + x).join('\n')})>`
    : `echo "${rebaseString}">`
  try { execSync(`git rebase -i ${commits[0].hash}`) } catch (e) {}

  const choices = ['subtract', 'add']
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

  for (let { subject, hs, name, email, date, cname, cemail } of selectedCommits) {
    const from = date.format('YYYY-MM-DD HH:mm')
    let m = method === 'set' ? moment(timeUnit) : date[method](timeUnit)
    console.log(`${c.yellow(`(${hs})`)}${c.bold(subject)} ${c.bold.cyan(from)} -> ${c.bold.green(m.format('YYYY-MM-DD HH:mm'))} `)
    Object.assign(process.env, {
      'GIT_AUTHOR_NAME': name,
      'GIT_AUTHOR_EMAIL': email,
      'GIT_AUTHOR_DATE': m.format(format),
      'GIT_COMMITTER_NAME': cname,
      'GIT_COMMITTER_EMAIL': cemail,
      'GIT_COMMITTER_DATE': m.format(format)
    })
    execSync(`git commit --amend --date="${date}" --no-edit`)
    execSync(`git rebase --continue`)
  }
  console.log(c.yellow.bold('Done!'))
})()
