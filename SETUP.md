# Potomac Law Group workshop: live storage setup

What is in this folder

    public/index.html              the workshop page (groups + facilitator view)
    netlify/functions/api.mjs      the small server program that saves and reads each group's work
    netlify.toml                   tells Netlify where things are
    package.json                   tells Netlify to install Netlify's storage library
    .gitignore                     files Git should ignore

How it works: each group opens its own link (for example  https://YOURSITE.netlify.app/#g=3&k=ab12cd34 ).
Their work saves to Netlify automatically every few seconds. The facilitator opens
https://YOURSITE.netlify.app/#admin , signs in with a PIN, and can see every group and put any
group's Share-out on the big screen.

See the chat message for the full click-by-click steps. Short version:

1. Put these files in a GitHub repository (keep the folder structure).
2. In Netlify: Add new project > Import an existing project > GitHub > pick the repository > Deploy.
3. In Netlify: Project configuration > Environment variables > add ADMIN_PIN (your facilitator PIN) > redeploy.
4. Open  https://YOURSITE.netlify.app/#admin , sign in, add groups, enter pain points, copy each group's link.

Notes
- Every production deploy uses 15 of the free plan's 300 monthly credits. Avoid redeploying on workshop day.
- Group links contain a secret key. Anyone with a group's link can edit that group's work.
- Data lives in Netlify Blobs. To start fresh for a new session, remove the groups in the facilitator view
  and add them again, or delete the store in Netlify (Project > Blobs).
