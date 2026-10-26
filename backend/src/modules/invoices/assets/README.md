# Invoice PDF assets

- `coolcare-logo.png`: exact 330 × 93 export of the logo slot `931:931` in the approved CoolCare invoice frame `931:928`. Source: https://www.figma.com/design/Ey8BiWPobpIlklonpb6wmp/PROJECT-CoolCare?node-id=931-928 . Only the logo is a raster asset; all invoice data is rendered as text.
- `RobotoCondensed-Regular.ttf` and `RobotoCondensed-Bold.ttf`: Vietnamese-capable static fonts from the Google Fonts Roboto repository, `src/hinted/RobotoCondensed-Regular.ttf` and `src/hinted/RobotoCondensed-Bold.ttf`: https://github.com/googlefonts/roboto/tree/main/src/hinted . Their Apache 2.0 license is preserved in `FONT-LICENSE.txt`.

These assets are bundled with the backend. PDF generation does not depend on external font or image requests.
