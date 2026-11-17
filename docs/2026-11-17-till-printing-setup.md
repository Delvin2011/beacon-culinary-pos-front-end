# Till printing setup

How to set up a Windows till so that receipts and kitchen tickets print by themselves on its 80 mm thermal printer.
Do this once per till, signed in to Windows as the account the till runs under.

**How printing works:** after each sale the till prints the customer receipt, then the kitchen ticket (only when the
order has kitchen items), on the same printer, without a print dialog. The cash drawer is opened by hand.

## 1. Make the thermal printer the Windows default

1. Install the printer's Windows driver from the manufacturer, and connect the printer.
2. Open **Settings → Bluetooth & devices → Printers & scanners**.
3. Turn off **Let Windows manage my default printer**.
4. Select the thermal printer, then **Set as default**.

## 2. Set the paper and the cutter in the printer driver

In **Printers & scanners**, select the thermal printer, then **Printing preferences** (the tabs depend on the driver):

1. **Paper size:** 80 mm (often called "80 x 297 mm" or "Roll paper 80 mm"). Choose the roll or "continuous" length
   if the driver offers it, so long receipts aren't split.
2. **Cutter:** cut at the end of each document ("Auto cut", "Cut per job" or "Paper cut: Document").
   The receipt and the kitchen ticket are two separate jobs, so each gets its own cut.
3. **Margins:** none, or the smallest the driver allows.
4. Save, then use **Print a test page**. Check that it comes out full width and is cut.

## 3. Create the kiosk shortcut (Chrome or Edge)

The till runs the POS in kiosk mode with silent printing: full screen, no browser controls, and printing goes straight
to the default printer with no dialog.

1. Right-click the desktop → **New → Shortcut**.
2. As the location, enter one of these on a single line, with the POS address at the end:

   **Edge**
   ```
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://POS-ADDRESS/pos/login --kiosk-printing --edge-kiosk-type=fullscreen
   ```
   **Chrome**
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://POS-ADDRESS/pos/login --kiosk-printing
   ```
3. Name it "POS" and finish. To start it with Windows, put a copy in the Startup folder (press Win + R, type
   `shell:startup`, and press Enter).
4. **Use a normal profile, never InPrivate or Incognito.** The till's registration and its printing switches are kept
   in the browser's data. A private window forgets them when it closes, and the till would then be unregistered.
5. Close every other window of the same browser before starting the shortcut. If the browser is already running, the
   kiosk switches are ignored.

To leave kiosk mode, press **Alt + F4**.

## 4. Turn off the browser's headers and footers

Kiosk printing uses the browser's last print settings. Turn headers and footers off once, from a normal (not kiosk)
window of the same browser and profile:

1. Open any page and press **Ctrl + P**.
2. Choose the thermal printer, then **More settings**.
3. Untick **Headers and footers**. Set **Margins** to **None**.
4. Print once (or cancel after changing the settings), then close the window.

The POS also sets a margin-free 80 mm page for receipts, but the header and footer switch belongs to the browser.

## 5. Register the till and check printing

1. Start the kiosk shortcut, sign in with an admin **password** (not a PIN), and open **Admin → Registered tills**.
   Register this till if it isn't registered yet.
2. On the same page, **Printing on this till** shows two switches:
   - **Print receipt automatically**
   - **Print kitchen ticket automatically**

   Both are on by default. They are saved in this browser only, so set them on each till.
3. Sign out, sign in as a cashier, and ring up a test sale with a kitchen item and a cold drink. Check that:
   - the receipt prints first, then a kitchen ticket listing only the kitchen item, each cut separately;
   - the receipt's time is the local time;
   - the header (business name, address, VAT number) is correct. An admin sets it under **Admin → Receipt Settings**.

## When the printer is out of paper or a print is lost

1. Load a new roll and close the cover.
2. On the till's completion screen (still showing the sale), press **Print receipt again** or
   **Print kitchen ticket again**. The copy is marked "COPY". These buttons disappear once you press **Next Customer**.
3. If the sale has moved on, or the copy can't be printed, press **Mark Print Failed** while the sale is on screen.
   A manager can then reprint a numbered copy from **Reports** (the receipt reprint).

The browser can't tell whether paper actually came out, so the till never marks a print as failed by itself.

## Things that reset the till

**Clearing the browser data** (cookies and site data) for the POS address, or using a different browser or profile,
does all of the following:

- it removes the till's registration, so the till must be registered again;
- it turns both automatic printing switches back on;
- it signs everyone out.

If either switch was turned off, set it again under **Admin → Registered tills → Printing on this till**.

## Troubleshooting

| Problem | Check |
|---|---|
| A print dialog appears | The shortcut is missing `--kiosk-printing`, or the browser was already running when the shortcut started. Close every window and start the shortcut again. |
| Prints go to the wrong printer | The thermal printer isn't the Windows default, or Windows is managing the default printer (step 1). |
| A date, URL or page number is printed | Headers and footers are still on (step 4). |
| The receipt is narrow, or split over two cuts | The paper size or cutter setting in the driver (step 2). |
| Nothing prints after a sale | The switches under **Printing on this till**. The printer is on, has paper, and the cover is closed. |
| The receipt has no business name | The header isn't set yet under **Admin → Receipt Settings**, or the till couldn't read it when the cashier signed in. Signing in again reads it again. |
