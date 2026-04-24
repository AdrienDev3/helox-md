# helox-md
A simple WhatsApp bot to manage groups 

# helox-md

A simple WhatsApp bot with two login modes:

- QR scan (`npm run start:qr`)
- Pairing code (`npm run start:pair`)

## Requirements

- Node.js 18+
- WhatsApp account

## Install

```bash
npm install
```

## Usage

### 1) QR mode

```bash
npm run start:qr
```

The terminal will show a QR code. Scan it from:
`WhatsApp > Linked devices > Link a device`

### 2) Pairing code mode

PowerShell:

```powershell
$env:PHONE_NUMBER="25261XXXXXXX"
npm run start:pair
```

You will receive an 8-digit code. Enter it in:
`WhatsApp > Linked devices > Link with phone number`

### Environment variables

PowerShell examples:

```powershell
$env:PREFIX="."
$env:OWNER_NUMBERS="25261XXXXXXX,25263YYYYYYY"
```

- `PREFIX`: command prefix (default: `.`)
- `OWNER_NUMBERS`: comma-separated owner phone numbers (digits only, country code included)

## Commands

### Basic

- `<prefix>ping` -> replies with `pong`
- `<prefix>help` / `<prefix>menu` -> shows command list

### Admin group commands

- `kick/remove/ban @user`
- `add <number>`
- `promote @user`
- `demote @user`
- `mute/close/lock`
- `unmute/open/unlock`
- `link`
- `revoke`
- `subject <new name>`
- `desc <new description>`
- `tagall`
- `hidetag <text>`
- `admins`
- `groupinfo`
- `leave`

### Owner-only commands

- `<prefix>owner` -> show configured owner numbers
- `<prefix>antilink on/off` -> enable/disable anti-link in current group
- `<prefix>join <group_invite_link>` -> join a group via invite link

The bot supports **400+ command aliases**.

## Notes

- Session data is stored in `auth_info/`.
- To reset login, delete `auth_info/` and start again.
- Anti-link removes non-admin users when they send links in a protected group (bot must be admin).
