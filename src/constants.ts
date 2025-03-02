/**
 * SVG icon for Mochi logo
 */
export const MOCHI_LOGO = `
<svg class="icon icon-tabler" width="20" height="20" fill="currentColor" version="1.1" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
 <path d="m330.6 1020c77.398 43.5 186.9 60 269.4 60s192.3-16.5 269.4-60h0.60156c78 0 179.4-34.801 248.1-90.898 49.801-40.801 81.898-92.398 81.898-149.1 0-71.699-30.898-236.1-120.6-382.2-91.199-148.2-241.8-277.8-479.4-277.8s-388.2 129.6-479.4 277.8c-89.703 146.1-120.6 310.5-120.6 382.2 0 56.398 32.398 108.3 81.898 149.1 68.699 56.102 170.1 90.898 248.1 90.898zm269.4 0c-89.398 0-216.9-17.699-278.4-81-48-49.199-44.398-134.7-24.602-176.1 3-6 3.6016-12.898 2.3984-19.199-8.6992-39.898-6.6016-71.102 6.6016-95.398 12.602-23.398 35.398-39.301 64.801-50.398 12.898-4.8008 20.699-18 19.199-31.5-7.1992-60.898 23.699-96.301 72.898-119.1 7.5-3.6016 13.199-9.8984 15.602-17.699 0 0 25.5-69.602 121.5-69.602s121.5 69.602 121.5 69.602c2.6992 7.8008 8.3984 14.102 15.602 17.699 49.199 23.102 80.398 58.199 72.898 119.1-1.8008 13.801 6.3008 26.699 19.199 31.5 29.398 11.102 52.199 27 64.801 50.398 13.199 24 15 55.5 6.6016 95.398-1.5 6.6016-0.60156 13.199 2.3984 19.199 19.801 41.398 23.699 126.9-24.602 176.1-61.5 63-189 81-278.4 81zm345.6-70.801c47.699-12.602 96.898-36 134.1-66.602 34.801-28.5 60-63 60-102.6 0-66-29.102-216.6-111.9-351-81.602-132.6-215.7-249-428.1-249-212.4 0-346.8 116.7-428.1 249-82.5 134.4-111.9 285-111.9 351 0 39.602 25.199 74.102 60 102.6 37.5 30.602 86.398 54 134.1 66.602-38.398-64.5-35.699-151.5-15.602-202.5-9.6016-52.801-3.3008-94.199 14.398-126.9 15.898-29.699 41.398-52.5 75.602-69-1.5-74.102 36.898-121.2 98.102-153 14.102-28.801 59.398-98.102 173.1-98.102 113.7 0 159.3 69 173.1 98.102 61.5 31.801 99.898 78.898 98.102 153 33.898 16.5 59.398 39.301 75.602 69 17.699 32.699 24 74.102 14.398 126.9 20.102 51 22.801 138-15.602 202.5zm-375.6-379.2-72-54c-13.199-9.8984-32.102-7.1992-42 6s-7.1992 32.102 6 42l108 81v63.301l-140.4-46.801c-15.602-5.3984-32.699 3.3008-37.801 18.898-5.3984 15.602 3.3008 32.699 18.898 37.801l159.6 53.102v42.898l-154.8 25.801c-16.199 2.6992-27.301 18.301-24.602 34.5 2.6992 16.199 18.301 27.301 34.5 24.602l145.2-24.301v24.602c0 16.5 13.5 30 30 30s30-13.5 30-30v-24.602l145.2 24.301c16.199 2.6992 31.801-8.3984 34.5-24.602 2.6992-16.199-8.3984-31.801-24.602-34.5l-154.8-25.801v-42.898l159.6-53.102c15.602-5.1016 24.301-22.199 18.898-37.801-5.1016-15.602-22.199-24.301-37.801-18.898l-140.4 46.801v-63.301l108-81c13.199-9.8984 15.898-28.801 6-42-9.8984-13.199-28.801-15.898-42-6l-72 54v-90c0-16.5-13.5-30-30-30s-30 13.5-30 30v90z" fill-rule="evenodd"/>
</svg>`;

/**
 * Regular expressions for parsing content
 */
export const PROPERTY_REGEX = /^([A-Za-z0-9\?\-]+)::\s*(.*)$/gm;
export const CARDTAG_REGEX = /#card */g;
export const CLOZE_REGEX = /\{\{cloze (.*?)\}\}/gm;

/**
 * Storage key for Mochi ID map
 */
export const MOCHI_ID_MAP_KEY = "mochiIdMap";
