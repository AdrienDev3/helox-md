#HELOX-MD

<div align="center">
  
<img src="https://capsule-render.vercel.app/api?type=waving&height=230&color=0:6a0dad,100:ab47bc&text=HELOX-MD&fontColor=ffffff&fontSize=85&fontAlignY=40&animation=twinkling&desc=Fast%20Pairing%20%7C%20Stable%20Group%20Bot&descSize=20&descAlignY=65&stroke=ffffff&strokeWidth=1.2" width="100%"/>

<h2 align="center">Built on Baileys • Designed for Speed • Enhanced for Stability</h2>

<h1 align="center">
  <img src="https://img.shields.io/badge/-✨_HELOX--MD_✨-purple?style=for-the-badge&logo=sparkles&logoColor=white&labelColor=0d1117&color=9d4edd" />
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/WhatsApp-MultiDevice-25D366?style=flat&logo=whatsapp&logoColor=white" alt="Multi-Device" />
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Baileys-Latest-blueviolet?style=flat" alt="Baileys" />
</p>
  
</div>

---

## Deploy Version `1.0.0`

---

## Quick Start

```bash
npm install
npm run start:qr
```

For pairing code mode:

```powershell
$env:PHONE_NUMBER="25261XXXXXXX"
npm run start:pair
```

---

## Pairing + HELOX Session ID

- When pairing/login completes, the bot creates a **unique HELOX-MD session ID**.
- Session ID format: `HELOX-XXXXXXXXXXXXXXXXXXXX`
- Saved in: `auth_info/helox-session.json`
- This ID is generated for your bot session and is unique to `helox-md`.

---

## Environment Variables

```powershell
$env:PREFIX="."
$env:OWNER_NUMBERS="25261XXXXXXX,25263YYYYYYY"
$env:PHONE_NUMBER="25261XXXXXXX"
```

- `PREFIX`: command prefix (default `.`)
- `OWNER_NUMBERS`: comma-separated owner numbers (digits only with country code)
- `PHONE_NUMBER`: required when using pairing mode

---

## Commands

### Basic
- `<prefix>ping`
- `<prefix>help`
- `<prefix>menu`

### Admin Group
- `kick/remove/ban @user`
- `add <number>`
- `promote @user`
- `demote @user`
- `mute` / `unmute`
- `link` / `revoke`
- `subject <name>`
- `desc <description>`
- `tagall`
- `hidetag <text>`
- `admins`
- `groupinfo`
- `leave`

### Owner Only
- `<prefix>owner`
- `<prefix>antilink on`
- `<prefix>antilink off`
- `<prefix>join <invite_link>`

> Includes 400+ command aliases.

---

## Anti-Link

- Enable with: `<prefix>antilink on`
- Disable with: `<prefix>antilink off`
- In protected groups, if a non-admin sends links, bot removes that user (bot must be admin).

---

## Project

- Repository: [AdrienDev3/helox-md](https://github.com/AdrienDev3/helox-md)
- License: Apache-2.0

---

<h3 align="center">Thanks for using HELOX-MD</h3>
<p align="center">If this project helps you, give it a star on GitHub.</p>


