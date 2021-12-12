import ignoreError from "./ignoreError";
import type { LatLng } from "./types";

const getAreaCenterFromUrl = (): LatLng | void => {
  const [unparsedAreaCenter] = window.location.pathname
    .split("/")
    .filter(Boolean);

  console.log( unparsedAreaCenter );

  if (
    unparsedAreaCenter &&
    /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/.test(
      unparsedAreaCenter
    )
  ) {
    const areaCenterPieces = unparsedAreaCenter.split(",");
    if (areaCenterPieces.length) {
      return ignoreError(() => ({
        lat: parseFloat(areaCenterPieces[0]),
        lng: parseFloat(areaCenterPieces[1]),
      }));
    }
  }
};

const getAreaCenterFromStorage = (): LatLng | void => {
  const unparsedValue = ignoreError(() => localStorage.getItem("centerLatLng"));
  if (unparsedValue) {
    const parsedValue = ignoreError(() => JSON.parse(unparsedValue));
    if (parsedValue.lat && parsedValue.lng) {
      return parsedValue;
    }
  }
};

const getParameterByName = ( name ) => {

	const url = window.location.href;

	// const stripHtml = html => (new DOMParser().parseFromString(html, 'text/html')).body.textContent || '';

	//name = name.replace(/[\[\]]/g, "\\$&");
	const regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
	const results = regex.exec( url );

	if (!results) return undefined;
	if (!results[2]) return '';

	let res = decodeURIComponent(results[2].replace(/\+/g, " "));
	let res2 = res.split(',');
	
	console.log( res2, 'foo' );

	return { lat: res2[0], lng: res2[1] };

	//return false;

}


export default () =>
	getParameterByName( 'loc' ) || 
  //getAreaCenterFromUrl();
  //getAreaCenterFromUrl() ||
  //getAreaCenterFromStorage() ||
  //({ lat: 51.89863, lng: -8.47039 } as LatLng);
  ({ lat: 51.89863, lng: -8.47039 } as LatLng);
	//console.log( 'param: ', getParameterByName( 'loc' ) );
