#!/usr/bin/env node
const moment = require('moment')
const { MultiSelect, Select, Snippet } = require('enquirer')
const { exec, makeEcho, colors: c } = require('./util')
const format = 'ddd MMM DD HH:mm YYYY Z'
const formatDispay = 'YYYY-MM-DD HH:mm'

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

;(async function () {
  if (exec`git status -s -uno`.length) {
    c.red.bold.println`You have uncommitted changes`
    return
  }
  try { exec`git rebase --abort -q` } catch (e) {}

  let stdout = exec`git log --format="${'%H%n%h%n%an%n%ae%n%ad%n%cn%n%ce%n%cd%n%s%n'}" -10`
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
        name: `${c.yellow`(${hs})`}${c.bold(date.format(formatDispay))}`,
        hint: `${c.green.bold(name)} ${subject}`,
        value: hash
      }
    })
  }).run()).map(x => ref[x])

  commits.reverse()
  selectedCommits.reverse()

  selectedCommits.forEach(x => { x.rebase = 'edit' })
  while (commits[0] && (commits[0].rebase === 'pick')) commits.shift()
  const rebaseString = commits.map(({ hs, subject, rebase }) => `${rebase} ${hs} ${subject}`).join('\n')
  process.env['GIT_SEQUENCE_EDITOR'] = makeEcho(rebaseString) + '>'

  const method = await new Select({
    name: 'method',
    message: 'Select moment manipulate method',
    choices: ['Set individually', 'Adjust all']
  }).run()

  const individual = method === 'Set individually'
  const fn = individual ? 'moment' : 'moment.duration'
  const days = individual ? 'date' : 'days'
  const template = `${fn}({
    minutes: ${c.yellow`\${minutes}`},
    hours: ${c.yellow`\${hours}`},
    ${days}: ${c.yellow`\${${days}}`},
    months: ${c.yellow`\${months}`},
    years: ${c.yellow`\${years}`}
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
    const validate = v => !isNaN(v)
    const fields = Object.keys(values).map(name => ({ name, validate }))

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
    const sequence = c.cyan`(${i + 1}/${selectedCommits.length})`
    const from = date.format(formatDispay)
    if (individual) {
      timeUnit = await askTime(`${c.yellow`(${hs})`}${c.bold(from)} ${c.green.bold(name)} ${subject}${sequence}`, date)
    } else if (!timeUnit) timeUnit = await askTime('Duration to add')
    const m = individual ? moment(timeUnit) : date.add(timeUnit)
    const newDate = m.format(format)
    const to = m.format(formatDispay)
    q.push(function () {
      c.println`${c.yellow`(${hs})`}${c.bold(subject)} ${c.bold.cyan(from)} -> ${c.bold.green(to)} `
      Object.assign(process.env, {
        'GIT_AUTHOR_NAME': name,
        'GIT_AUTHOR_EMAIL': email,
        'GIT_AUTHOR_DATE': newDate,
        'GIT_COMMITTER_NAME': cname,
        'GIT_COMMITTER_EMAIL': cemail,
        'GIT_COMMITTER_DATE': newDate
      })
      exec`git commit --amend --date="${newDate}" --no-edit`
      exec`git rebase --continue`
    })
  }
  try { exec`git rebase -i ${commits[0].hash}` } catch (e) {}
  q.forEach(x => x())
  c.yellow.bold.println`Done!`
})()
