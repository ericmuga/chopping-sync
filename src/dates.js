/** Yesterday's calendar date in WMS local time (GMT+3), used as SQL midnight. */
export const getYesterdayWmsDate = (now = new Date()) => {
  const wmsYesterday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  wmsYesterday.setUTCDate(wmsYesterday.getUTCDate() - 1);
  return wmsYesterday.toISOString().slice(0, 10);
};
