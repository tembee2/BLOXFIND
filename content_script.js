// Extract a userId from a Roblox profile URL or page.
(function(){
function extractFromUrl(url){
// Matches /users/<id>/profile
const m = url.match(/\/users\/(\d+)\/profile/);
return m ? m[1] : null;
}


const userId = extractFromUrl(location.href) || null;
// Expose the user id for the popup via a DOM property to avoid messaging complexity
if (userId) {
document.documentElement.dataset.robloxUserId = userId;
}
})();