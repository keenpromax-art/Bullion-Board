// Sector peer map — ported from special.py run_sector_analysis SECTORS.
// Used by the SCA desk to preselect the sector of the active ticker.
export const SECTORS: Record<string, { name: string; tickers: string[] }> = {
  "1": { name: "IT / Software", tickers: ["TCS.NS", "INFY.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS", "LTIM.NS", "MPHASIS.NS", "COFORGE.NS", "PERSISTENT.NS", "LTTS.NS", "TATAELXSI.NS", "CYIENT.NS"] },
  "2": { name: "Banking", tickers: ["HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS", "INDUSINDBK.NS", "BANKBARODA.NS", "PNB.NS", "IDFCFIRSTB.NS", "FEDERALBNK.NS", "BANDHANBNK.NS", "CANBK.NS"] },
  "3": { name: "Financial Services", tickers: ["BAJFINANCE.NS", "BAJAJFINSV.NS", "SHRIRAMFIN.NS", "CHOLAFIN.NS", "MUTHOOTFIN.NS", "M&MFIN.NS", "MANAPPURAM.NS", "POONAWALLA.NS", "LICHSGFIN.NS", "PFC.NS", "RECLTD.NS", "CANFINHOME.NS"] },
  "4": { name: "Pharmaceuticals", tickers: ["SUNPHARMA.NS", "DRREDDY.NS", "CIPLA.NS", "DIVISLAB.NS", "AUROPHARMA.NS", "BIOCON.NS", "LUPIN.NS", "TORNTPHARM.NS", "ALKEM.NS", "IPCALAB.NS", "LAURUSLABS.NS", "GLENMARK.NS"] },
  "5": { name: "Metals & Mining", tickers: ["TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "COALINDIA.NS", "NMDC.NS", "NATIONALUM.NS", "SAIL.NS", "JINDALSTEL.NS", "MOIL.NS", "WELCORP.NS", "RATNAMANI.NS"] },
  "6": { name: "Oil & Refineries", tickers: ["RELIANCE.NS", "ONGC.NS", "BPCL.NS", "IOC.NS", "HINDPETRO.NS", "GAIL.NS", "PETRONET.NS", "OIL.NS", "MRPL.NS", "CHENNPETRO.NS", "CASTROLIND.NS", "IGL.NS"] },
  "7": { name: "Automobiles", tickers: ["MARUTI.NS", "M&M.NS", "TATAMOTORS.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS", "EICHERMOT.NS", "ASHOKLEY.NS", "TVSMOTOR.NS", "ESCORTS.NS", "MOTHERSON.NS", "BHARATFORG.NS", "EXIDEIND.NS"] },
  "8": { name: "FMCG", tickers: ["HINDUNILVR.NS", "NESTLEIND.NS", "BRITANNIA.NS", "DABUR.NS", "MARICO.NS", "GODREJCP.NS", "TATACONSUM.NS", "COLPAL.NS", "EMAMILTD.NS", "VBL.NS", "JYOTHYLAB.NS", "BIKAJI.NS"] },
  "9": { name: "Insurance", tickers: ["SBILIFE.NS", "HDFCLIFE.NS", "ICICIPRULI.NS", "ICICIGI.NS", "LICI.NS", "STARHEALTH.NS", "GICRE.NS", "MAXHEALTH.NS", "POLICYBZR.NS"] },
  "10": { name: "Cement & Construction", tickers: ["ULTRACEMCO.NS", "GRASIM.NS", "AMBUJACEM.NS", "SHREECEM.NS", "ACC.NS", "RAMCOCEM.NS", "JKCEMENT.NS", "JKLAKSHMI.NS", "HEIDELBERG.NS", "BIRLACEM.NS"] },
  "11": { name: "Power & Energy", tickers: ["NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS", "ADANIPOWER.NS", "NHPC.NS", "SJVN.NS", "IREDA.NS", "ADANIGREEN.NS", "TORNTPOWER.NS", "CESC.NS"] },
  "12": { name: "Telecom", tickers: ["BHARTIARTL.NS", "IDEA.NS", "INDUSTOWER.NS", "ROUTE.NS", "HFCL.NS", "TANLA.NS", "RAILTEL.NS"] },
  "13": { name: "Real Estate", tickers: ["DLF.NS", "GODREJPROP.NS", "PRESTIGE.NS", "OBEROIRLTY.NS", "PHOENIXLTD.NS", "BRIGADE.NS", "SOBHA.NS", "LODHA.NS", "MAHLIFE.NS", "KOLTEPATIL.NS"] },
  "14": { name: "Entertainment & Media", tickers: ["ZEEL.NS", "PVR.NS", "SUNTV.NS", "NETWORK18.NS", "SAREGAMA.NS", "TIPS.NS", "NAZARA.NS", "TVTODAY.NS"] },
  "15": { name: "Textiles & Apparel", tickers: ["PAGEIND.NS", "RAYMOND.NS", "ARVIND.NS", "TRIDENT.NS", "WELSPUNLIV.NS", "KPRMILL.NS"] },
  "16": { name: "Agro-Chemicals", tickers: ["UPL.NS", "PIIND.NS", "DHANUKA.NS", "RALLIS.NS", "BAYERCROP.NS", "SUMICHEM.NS", "GSFC.NS", "COROMANDEL.NS"] },
  "17": { name: "Jewellery & Gems", tickers: ["TITAN.NS", "KALYANKJIL.NS", "SENCO.NS", "PCJEWELLER.NS", "THANGAMAYL.NS", "GOLDIAM.NS"] },
  "18": { name: "Tyres", tickers: ["MRF.NS", "APOLLOTYRE.NS", "BALKRISIND.NS", "CEATLTD.NS", "JKTYRE.NS", "GOODYEAR.NS"] },
  "19": { name: "Edible Oil & Foods", tickers: ["ADANIWILMAR.NS", "KRBL.NS", "BIKAJI.NS", "VENKEYS.NS", "HATSUN.NS", "AVANTIFEED.NS", "LTFOODS.NS"] },
  "20": { name: "Shipping & Logistics", tickers: ["ADANIPORTS.NS", "CONCOR.NS", "SCI.NS", "BLUEDART.NS", "ALLCARGO.NS", "TCI.NS", "VRL.NS"] },
};

export function sectorOf(ticker: string): string | null {
  const t = (ticker || "").toUpperCase().trim();
  for (const [k, s] of Object.entries(SECTORS)) {
    if (s.tickers.includes(t)) return k;
  }
  return null;
}
