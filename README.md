# 41 Cards

Permainan kartu **41** berbasis web, terinspirasi dari permainan kartu remi yang populer di Indonesia. Setiap pemain berusaha menyusun empat kartu dengan kembang yang sama dan nilai setinggi mungkin. Nilai sempurna adalah **41**.

> Proyek ini masih dalam tahap perencanaan. README ini menjadi acuan awal sebelum implementasi dimulai.

## Aturan permainan

### Tujuan

Kumpulkan empat kartu dengan kembang yang sama—sekop (♠), hati (♥), wajik (♦), atau keriting (♣)—dengan total nilai mendekati atau tepat 41.

### Nilai kartu

| Kartu | Nilai |
| --- | ---: |
| As | 11 |
| King, Queen, Jack | 10 |
| 2–10 | Sesuai angka kartu |

Skor pemain dihitung dari kartu-kartu pada **satu kembang yang menghasilkan total tertinggi**. Kartu dari kembang lain tidak ikut menambah skor.

Contoh:

- A♠, K♠, Q♠, J♠ = **41 poin**
- A♥, K♥, 9♥, 4♣ = **30 poin** dari kartu hati
- 10♦, 8♦, 7♣, 6♣ = **18 poin** dari kartu wajik

### Persiapan

- Menggunakan satu set kartu remi standar berisi 52 kartu tanpa Joker.
- Dimainkan oleh 2–4 pemain.
- Setiap pemain menerima empat kartu.
- Sisa kartu diletakkan tertutup sebagai tumpukan ambil.
- Satu kartu dibuka sebagai awal tumpukan buang.

### Alur giliran

Pada setiap giliran, pemain:

1. Mengambil satu kartu dari tumpukan ambil atau kartu teratas dari tumpukan buang.
2. Memilih satu dari lima kartu di tangan untuk dibuang.
3. Mengakhiri giliran dengan tetap memegang empat kartu.

Permainan berlanjut searah jarum jam.

### Akhir permainan

Ronde berakhir ketika:

- seorang pemain memperoleh tepat 41 poin; atau
- tumpukan ambil habis.

Pemain dengan skor tertinggi menjadi pemenang. Jika skor seri, hasil ronde dinyatakan seri pada versi awal permainan.

## Ruang lingkup MVP

- Permainan lokal satu pemain melawan bot.
- Satu meja dengan total 2–4 pemain.
- Pengacakan dan pembagian kartu.
- Mekanisme ambil dan buang kartu.
- Perhitungan skor otomatis.
- Deteksi akhir ronde dan tampilan hasil.
- Tombol untuk memulai ronde baru.
- Antarmuka responsif untuk desktop dan ponsel.

Belum termasuk multiplayer daring, akun, taruhan, chat, peringkat, atau penyimpanan progres.

## Prinsip permainan

- Permainan ditujukan untuk hiburan tanpa uang asli atau perjudian.
- Informasi giliran, jumlah kartu, dan skor akhir harus terlihat jelas.
- Kartu lawan tetap tertutup selama ronde berlangsung.
- Logika pengacakan, giliran, skor, dan kemenangan harus dapat diuji secara terpisah.

## Menjalankan permainan

Buka `index.html` langsung di browser atau jalankan melalui web server lokal:

```text
http://localhost/41cards/
```

Tidak ada proses build atau instalasi dependensi. Tailwind CSS dan font dimuat melalui CDN.

## Cara bermain versi web

1. Klik tumpukan **Ambil** atau **Buangan**.
2. Setelah tangan berisi lima kartu, klik satu kartu untuk membuangnya.
3. Tiga bot akan menjalankan giliran secara otomatis.
4. Ronde selesai saat ada pemain mencapai 41 atau tumpukan kartu habis.

## Referensi aturan

- [Empat Satu (41) — Pagat](https://www.pagat.com/draw/41.html)

Aturan 41 memiliki beberapa variasi daerah. Ketentuan dalam dokumen ini dipilih sebagai aturan dasar proyek dan dapat disesuaikan sebelum pengembangan dimulai.

## Lisensi

Belum ditentukan.
