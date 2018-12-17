#!/usr/bin/env node
const moment = require('moment')
const { MultiSelect, Select, Snippet, Form } = require('enquirer')
const { exec, makeEcho, colors: c } = require('./util')
const format = 'ddd MMM DD HH:mm YYYY Z'
const formatDispay = 'YYYY-MM-DD HH:mm'
const [,, limit = 10] = process.argv

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

const setEnv = function ({ name, email, date }) {
  return Object.assign(process.env, {
    'GIT_AUTHOR_NAME': name,
    'GIT_AUTHOR_EMAIL': email,
    'GIT_AUTHOR_DATE': date,
    'GIT_COMMITTER_NAME': name,
    'GIT_COMMITTER_EMAIL': email,
    'GIT_COMMITTER_DATE': date
  })
}
const itemInfo = function ({ hs, date, name, subject, sequence }) {
  return `${c.yellow`(${hs})`} ${c.bold(date.format(formatDispay))} ${c.green.bold(name)} ${subject}${c.cyan(sequence)}`
}

;(async function () {
  if (exec`git status -s -uno`.length) {
    c.red.bold.println`You have uncommitted changes`
    return
  }
  try { exec`git rebase --abort` } catch (e) {}

  const stdout = exec`git log --format=${'%H%n%h%n%an%n%ae%n%ad%n%cn%n%ce%n%cd%n%s%n'} -${limit}`
  const ref = {}
  const commits = stdout.split('\n\n').map((x, idx) => {
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
    limit,
    validate (v) { return !!v.length },
    result (names) {
      return Object.values(this.map(names))
    },
    choices: commits.map(({ hash, hs, name, date, subject }) => ({
      name: `${c.yellow`(${hs})`} ${c.bold(date.format(formatDispay))}`,
      hint: `${c.green.bold(name)} ${subject}`,
      value: hash
    }))
  }).run()).map(x => ref[x])

  commits.reverse()
  selectedCommits.reverse()
  selectedCommits.forEach(x => { x.rebase = 'edit' })
  while (commits[0] && (commits[0].rebase === 'pick')) commits.shift()
  const rebaseString = commits.map(({ hs, subject, rebase }) => `${rebase} ${hs} ${subject}`).join('\n')
  process.env['GIT_SEQUENCE_EDITOR'] = makeEcho(rebaseString) + '>'

  const mode = {}
  const modeName = await new Select({
    name: 'mode',
    message: 'Select mode',
    choices: [
      { name: 'info', message: 'Edit info', hint: `- author,email,message` },
      { name: 'set', message: 'Set date', hint: `- change date individually` },
      { name: 'adjust', message: 'Adjust date', hint: `- add duration to all selected` }
    ]
  }).run()
  mode[modeName] = true

  async function editInfo ({ subject, hs, name, email, date, cname, cemail, cdate }, sequence) {
    const message = itemInfo({ hs, date, name, subject, sequence })
    const to = await new Form({
      name: 'commit',
      message,
      choices: [
        { name: 'name', message: 'Name', initial: name },
        { name: 'email', message: 'Email', initial: email },
        { name: 'subject', message: 'Message', initial: subject }
      ]
    }).run()
    const diff = { name: name !== to.name, email: email !== to.email, subject: subject !== to.subject }
    to.date = date
    q.push(() => {
      c.println`running.. ${c.cyan(sequence)}`
      setEnv(to)
      if (diff.name || diff.email) exec`git commit --amend --no-edit --author="${to.name} <${to.email}>"`
      if (diff.subject) exec`git commit --amend --no-edit -m "${to.subject}"`
      exec`git rebase --continue`
    })
  }

  const q = []
  async function askTime (message, date) {
    const fn = c.bold`moment` + (mode.set ? '' : `.${c.yellow`duration`}`)
    const days = mode.set ? 'date' : 'days'
    const template = `${fn}({
    minutes: ${c.yellow`\${minutes}`},
    hours: ${c.yellow`\${hours}`},
    ${days}: ${c.yellow`\${${days}}`},
    months: ${c.yellow`\${months}`},
    years: ${c.yellow`\${years}`}
  })`
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
  let timeUnit
  async function changeTime ({ subject, hs, name, email, date, cname, cemail }, sequence) {
    if (mode.set) timeUnit = await askTime(itemInfo({ hs, date, name, subject, sequence }), date)
    else if (!timeUnit) timeUnit = await askTime('Duration to add')
    const m = mode.set ? moment(timeUnit) : date.add(timeUnit)
    const newDate = m.format(format)
    q.push(() => {
      c.println`running.. ${c.cyan(sequence)}`
      setEnv({ name, email, date: newDate })
      exec`git commit --amend --no-edit --date="${newDate}" --author="${name} <${email}>"`
      exec`git rebase --continue`
    })
  }
  for (let i = 0; i < selectedCommits.length; i++) {
    const sequence = `(${i + 1}/${selectedCommits.length})`
    if (mode.info) await editInfo(selectedCommits[i], sequence)
    else await changeTime(selectedCommits[i], sequence)
  }
  try { exec`git rebase -i ${commits[0].hash}` } catch (e) {}
  q.forEach(x => x())
  c.yellow.bold.println`Done!`
})().catch(e => {
  c.red.bold.println(e.toString())
})
