# Offline outage drill

A checklist for rehearsing a network outage on a real registered till, before relying on offline selling in service. It takes about an hour with one till, plus about 20 minutes for the two-till part. Do it outside trading hours, on a test trading day if possible: every sale you ring is recorded.

You need:

- A registered till with a receipt printer, set up as in `2026-11-17-till-printing-setup.md`.
- Offline turned on for the till (`offlineEnabled`), and offline account sales turned on with a cap.
- A cashier with a PIN, and a manager with ADMIN access.
- One account to charge.
- A second registered till for part 7.
- For part 4, a way to shorten the offline limits: the `warnOfflineHours` and `maxOfflineHours` settings, for example 0.1 and 0.2 hours (6 and 12 minutes). Put them back afterwards.

Tick each line. If a line fails, write down the time, the till code and what the screen said, then carry on if you can.

## 1. Get the till ready

- [ ] The cashier signs in with their PIN and opens a shift (or continues one).
- [ ] The header shows **Offline ready** within a minute.
- [ ] On **Registered tills** (manager, on the same browser), the **This browser** card shows a grant for this shift, today's menu copy and an unlock check value.
- [ ] Ring one normal online sale, so you know the printer works.

## 2. Pull the cable mid-shift

- [ ] Pull the network cable (or turn off Wi-Fi). Don't reload the page.
- [ ] Within about a minute the connection indicator says offline, and the banner says **Offline mode** with the time offline.
- [ ] The menu changes to **Offline copy of today's menu… Selling offline**. Tiles show their counts.
- [ ] **Complimentary**, **Add Discount**, **Reading** and **End shift** are disabled and say **Not available offline**.

## 3. Sell offline

- [ ] **Cash:** add an item, Charge, enter more cash than the total, **Confirm offline sale**. The screen shows **Offline sale recorded**, a collection number like **T1-1** and the change.
- [ ] The receipt prints with **Offline sale**, the collection number in large type, and a receipt number like **T1-20261118-0001**. A kitchen item also prints a kitchen ticket with the same collection number.
- [ ] **Card:** run the card machine first, then add the item, Charge, **Card**. Confirm stays disabled until you type the **card slip reference**. The receipt shows the reference.
- [ ] **Account:** Charge, **Account**, pick the account. No manager PIN is asked.
- [ ] Charge the same account again until it passes the cap: the till refuses with **Account limit for offline sales reached (R…)** and keeps the cart.
- [ ] Sell an item until its count reaches 0: its tile shows **Sold out** and can't be added.
- [ ] **Print receipt again** on the completion screen prints a copy marked COPY.
- [ ] The banner counts the sales waiting: **3 sales waiting to send**.
- [ ] **Today's Orders** lists them marked **Offline, not yet sent**.

## 4. Reload, lock and unlock, and the limits

- [ ] Reload the browser (F5). The till comes back to the POS with the shift, and the banner still counts the waiting sales.
- [ ] **Lock till**. The sign-in screen asks only this cashier for their PIN (**Enter your PIN**). Enter it: the till unlocks offline.
- [ ] Ring one more sale. Note its collection number: it should be marked as sold after an offline unlock (part 5).
- [ ] Enter a wrong PIN 5 times: the screen counts the tries left, then refuses until the till is online. Use a test cashier, or skip this line.
- [ ] With the shortened limits: at the warning time the banner turns amber (**Get back online soon**). At the limit it turns red: **Offline limit reached. Reconnect to keep selling.** Charge and Confirm are no longer offered.

## 5. Reconnect and watch the sync

- [ ] Plug the cable back in. Within about a minute the indicator says online.
- [ ] A small **Sending N offline sales…** note appears, then goes.
- [ ] **End shift** is no longer disabled once every sale is sent. Before that it says how many are still to send.
- [ ] **Today's Orders** shows the sales with **Offline sale** and their collection numbers.
- [ ] On **POS Activity → Tills**, this till shows **OK** (0 unsynced) within a couple of minutes.

## 6. Check the books (manager)

- [ ] **Sale exceptions** (sidebar, with a count) lists what the sales raised. Expect at least one **Account charge to approve** per account sale, and **Unlocked offline** (filter **For information**) for the sale after the unlock.
- [ ] Open an account charge, **Approve account charge**. It moves to **Resolved** with your name.
- [ ] Open any other exception, try **Resolve** without a note (refused), then with a note.
- [ ] Reprint an offline sale's receipt (Reports): it shows the same receipt and collection numbers as the slip.
- [ ] The cashier closes the shift and counts the drawer: the offline cash is in the expected cash.
- [ ] The X reading shows the **Offline sales** section. The Z shows it too, and its checks list open offline exceptions as a warning, not a failure.

## 7. Two tills

- [ ] Get both tills ready (part 1), each with its own cashier and shift.
- [ ] Pull both cables. Sell 2 or 3 sales on each, including the same item.
- [ ] Each till numbers its own sales (**T1-…**, **T2-…**). No numbers are shared.
- [ ] Reconnect both. Both sync, and **Sale exceptions** shows any **Oversold** where the two tills together sold more than was left.

## 8. Put things back

- [ ] Restore the offline limits if you changed them.
- [ ] Refund or void the drill's sales if they shouldn't count.
- [ ] If any offline sales appear on **Registered tills → Offline sales that need support**, use **Copy details for support** and send the details to support before doing anything else.
