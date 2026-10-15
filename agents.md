# Task Workflow: Commit & Push Guidelines

Setiap kali ada task yang diselesaikan, berikut prosedur yang harus dilakukan:

## 1. Commit perubahan

Setelah selesai mengedit file, lakukan commit dengan pesan yang deskriptif:

```bash
git add .
git commit -m "feat: deskripsi perubahan yang dilakukan"
# atau
git add .
git commit -m "fix: perbaikan bug"
# atau
git add .
git commit -m "docs: menambah dokumentasi"
```

## 2. Push ke repository

Setelah commit, push perubahan ke remote repository:

```bash
git push origin main
# atau ke branch yang aktif
git push origin HEAD
```

## 3. Verifikasi

Cek status repository setelah push:

```bash
git status
git log -1 --oneline
```

## Contoh Alur Kerja Lengkap

```bash
# 1. Lihat status perubahan
git status

# 2. Edit file (misal: style.js)

# 3. Tambahkan file yang diubah
git add .

# 4. Commit dengan pesan yang jelas
git commit -m "fitur: menambahkan efek 3D pada kartu playing-card"

# 5. Push ke remote
git push origin main
```

## Best Practices

- **Commit secara sering** - Commit setiap perubahan kecil atau fitur yang completed
- **Pesan commit yang jelas** - Gunakan format `tipe: deskripsi` (feat, fix, docs, style, refactor, test, chore)
- **Push setelah commit** - Selalu push setelah commit lokal untuk memastikan backup
- **Tidak ada commit yang rusak** - Pastikan semua test lolos sebelum commit
- **Jangan push ke branch utama jika belum test** - Gunakan branch fitur terlebih dahulu

## Ringkas

Setiap task selesai → `git add .` → `git commit -m "pesan"` → `git push origin main`