#!/usr/bin/env node
const moment = require('moment')
const format = 'ddd MMM DD HH:mm YYYY Z'
const formatDispay = 'YYYY-MM-DD HH:mm'
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
    return {
      hash,
      hs,
      subject,
      name,
      email,
      date: moment(date, format),
      cname,
      cemail,
      cdate: moment(cdate, format),
      idx,
      rebase: 'pick'
    }
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
        name: `${c.yellow(`(${hs})`)}${c.bold(date.format(formatDispay))}`,
        hint: `${c.green.bold(name)} ${subject}`,
        value: hash
      }
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

  const choices = ['Set individually', 'Adjust all']
  const method = await new Select({
    name: 'method',
    message: 'Select moment manipulate method',
    choices
  }).run()

  const fn = method === 'Set individually' ? 'moment' : 'moment.duration'
  const days = method === 'Set individually' ? 'date' : 'days'
  const template = `${fn}({
    minutes: ${c.yellow(`\${minutes}`)},
    hours: ${c.yellow(`\${hours}`)},
    ${days}: ${c.yellow(`\${${days}}`)},
    months: ${c.yellow(`\${months}`)},
    years: ${c.yellow(`\${years}`)}
  })`

  let timeUnit
  async function askTime (message, date) {
    const values = date ? date.toObject() : {
      minutes: 0,
      hours: 0,
      days: 0,
      months: 0,
      years: 0
    }
    Object.keys(values).forEach(key => { values[key] += '' })
    const fields = Object.keys(values).map(name => { return { name, validate (v) { return !isNaN(v) } } })

    const { values: ret } = await new Snippet({
      name: 'Time unit',
      message,
      fields,
      format () { return '' },
      values,
      template
    }).run()
    return ret
  }

  const q = []
  for (let i = 0; i < selectedCommits.length; i++) {
    const { subject, hs, name, email, date, cname, cemail } = selectedCommits[i]
    const sequence = `(${i + 1}/${selectedCommits.length})`
    const from = date.format(formatDispay)
    if (method === 'Set individually') {
      timeUnit = await askTime(`${c.yellow(`(${hs})`)}${c.bold(from)} ${c.green.bold(name)} ${subject}${sequence}`, date)
    } else if (!timeUnit) timeUnit = await askTime('Duration to add')
    const m = method === 'Set individually' ? moment(timeUnit) : date.add(timeUnit)
    const newDate = m.format(format)
    const to = m.format(formatDispay)
    q.push(function () {
      console.log(`${c.yellow(`(${hs})`)}${c.bold(subject)} ${c.bold.cyan(from)} -> ${c.bold.green(to)} `)
      Object.assign(process.env, {
        'GIT_AUTHOR_NAME': name,
        'GIT_AUTHOR_EMAIL': email,
        'GIT_AUTHOR_DATE': newDate,
        'GIT_COMMITTER_NAME': cname,
        'GIT_COMMITTER_EMAIL': cemail,
        'GIT_COMMITTER_DATE': newDate
      })
      execSync(`git commit --amend --date="${newDate}" --no-edit`)
      execSync(`git rebase --continue`)
    })
  }
  q.forEach(x => x())
  console.log(c.yellow.bold('Done!'))
})()
