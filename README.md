# Sole What - Smart Point of Sale (POS) System

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/github/stars/bhaijew/sole" alt="Stars">
  <img src="https://img.shields.io/github/contributors/bhaijew/sole" alt="Contributors">
</p>

**Sole What** is a high-performance, offline-first Point of Sale (POS) system designed for restaurants, cafes, pizza shops, fast food, and retail. It operates seamlessly offline on your local machine with automatic cloud synchronization, dual-printer support, thermal printing, and Kitchen Display System (KDS).

## 🌟 Why Sole What?

- **💰 Completely Free & Open** - No forced subscriptions, self-hosted on your own computer
- **📴 Offline-First** - Full POS operations without internet requirement
- **⚡ Super Fast Ordering** - Instant cart, modifier selection, and 1-click billing
- **🍽️ Restaurant & Pizza Ready** - Real-time tables, recipe inventory, and KDS
- **🧾 Dual Thermal Printers** - Supports counter receipt printer + kitchen KOT printer (58mm/80mm)
- **☁️ Cloud Sync** - Seamless real-time online order reception and menu sync
- **🖥️ Cross-Platform** - Windows (.exe), macOS, and Linux

## 📦 Downloads

| Platform | File | Description |
|----------|------|-------------|
| **Windows** | `Sole What Setup 1.6.1.exe` | Windows 64-bit Installer |
| **macOS (Intel)** | `Sole-What-1.6.1.dmg` | For Intel Macs |
| **macOS (Apple Silicon)** | `Sole-What-1.6.1-arm64.dmg` | For Apple Silicon (M1/M2/M3) Macs |
| **Linux (AppImage)** | `Sole-What-1.6.1.AppImage` | Portable Linux binary |
| **Linux (Debian)** | `sole-what_1.6.1_amd64.deb` | Debian/Ubuntu package |

**Latest Version:** v1.6.1  
Check all releases: [Sole What Releases](https://github.com/bhaijew/sole/releases)

## 🚀 Features

### Core POS
- [x] Fast touchscreen & keyboard order entry
- [x] Customer name field option for manual orders & receipts
- [x] Multiple order modes (Dine-in, Takeaway, Delivery, Online)
- [x] Real-time table floor-plan management
- [x] Addons, variants, modifiers, and custom kitchen notes
- [x] Instant checkout with Cash, Card, EasyPaisa, and custom methods

### Restaurant & Kitchen
- [x] Real-time Kitchen Display System (KDS) with WebSocket updates
- [x] Kitchen Order Tickets (KOT) auto-printing and reprinting
- [x] Multi-station kitchen routing
- [x] Recipe & Raw Material Inventory tracking with wastage logs

### Dual Thermal Printing
- [x] ESC/POS direct thermal receipt printing (USB, Network IP/TCP, WebUSB)
- [x] Independent Counter Printer + Kitchen Printer assignment
- [x] Configurable paper widths (58mm and 80mm)
- [x] Customer Copy & Business Copy options
- [x] Prominent Customer Name display on receipts and KOTs

### Cloud Sync & Online Orders
- [x] Real-time online order reception with audio alert
- [x] Multi-tenant shop and branch isolation
- [x] Cloud menu synchronization

## 🖥️ Tech Stack

- **Runtime:** Electron 31
- **Backend:** Express.js + TypeScript
- **Frontend:** Next.js (React, TypeScript)
- **Database:** SQLite (better-sqlite3) with WAL mode & automated backups
- **Styling:** Tailwind CSS + Radix UI / shadcn
- **Real-time:** WebSockets for live KDS & Cloud Events

## 💾 System Requirements

### Minimum Requirements
- **OS:** Windows 10/11 (64-bit), macOS 11+, or modern Linux
- **RAM:** 4 GB minimum (8 GB recommended)
- **Disk:** 500 MB free space
- **Node.js:** 20+ (for source development only)

### Hardware Supported
- Standard ESC/POS Thermal Printers (Epson, Xprinter, Star, Rongta, etc.)
- USB, Network (LAN / Wi-Fi), and Serial thermal receipt printers
- Barcode scanners & cash drawers (RJ11 / RJ12 via printer kick-out)

## 🔧 Development Setup

```bash
# Clone the repository
git clone https://github.com/bhaijew/sole.git
cd sole

# Install root dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start in development mode
npm run dev

# Fast backend development with pre-built UI
npm run dev:fast
```

### Build Installers

```bash
# Windows Installer (.exe)
npm run build:win

# macOS Installer (.dmg)
npm run build:mac

# Linux (.AppImage, .deb)
npm run build:linux
```

## 🏗️ Architecture

```
sole/
├── main/                   # Electron backend & local API
│   ├── db.ts               # SQLite schema & incremental migrations
│   ├── server.ts           # Express HTTP & WebSocket server
│   ├── routes/             # REST API endpoints (orders, bills, printers, etc.)
│   ├── printers/           # ESC/POS thermal encoders & print drivers
│   └── services/           # Cloud sync, KDS, inventory & tax services
├── frontend/               # Next.js POS UI
│   └── src/
│       ├── app/            # App router pages (pos, orders, tables, settings)
│       ├── components/     # UI components (CartPanel, ProductGrid, modals)
│       ├── hooks/          # React hooks (usePrinter, etc.)
│       └── store/          # Zustand state stores (cart, auth, settings)
└── release/                # Generated installer packages (.exe)
```

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the **MIT License**.

---

<p align="center">
  <strong>Sole What POS</strong> - Fast, reliable, and intelligent Point of Sale.<br>
  ⭐ Star us on GitHub: <a href="https://github.com/bhaijew/sole">https://github.com/bhaijew/sole</a>
</p>
