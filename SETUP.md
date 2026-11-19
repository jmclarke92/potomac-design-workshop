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

Workshop versions (facilitator picker)
- After "Start new session" erases everything, the facilitator view opens on a picker. Pick the version you are running.
- Live versions save work and use group links. Versions marked "Demo only" link out to a one-screen demo (public/index.html#demo=<id>).
- Seyfarth in the Future runs live (pick it in the facilitator view). Its stages follow the Seyfarth workbook: Our Challenge, I Hate It When (the team chooses one), End User, Problem Statement, Analogy Finding, Individual and Group Brainstorm, Prioritization, and a Report Out summary.

Seyfarth setup and running (5-10 groups)
1. Facilitator view -> choose Seyfarth -> pick how many groups (5-10), then type each group's names (one per line) or paste a whole roster ("Name, group number" per line). Names must be unique across the room.
2. Worksheet QR: the "Worksheet QR" button shows one code for the whole room (it opens /me). Download the image and put it on the worksheet. Participants scan it, tap their name, and type their challenge, with an optional second one. A name that isn't on the list can add itself to a group. The facilitator view shows a check mark beside everyone who has entered a challenge.
3. Send each Hub its group link (Links button). The group's Our Challenge screen opens with the names and challenges already filled in. They can still edit anything, add a teammate and remove teammates. Challenges entered while a group is on that first screen appear within a few seconds.
4. Report Out: each group's last step, and the facilitator's Present button, show a one-screen summary: end user, problem statement, directional ideas, and where the ideas fall on the matrix. The facilitator view has a Full screen button for the share-out.
- The phone page only lists names and who is "in". Challenge text goes only to that group's own Hub (and the facilitator view).
- You can change the version only while no groups exist. Otherwise use "Start new session" first.
- To add a version: add it to VERSIONS in public/index.html; when it is live, also add its id to LIVE_VERSIONS in netlify/functions/api.mjs.
- A session saved before the picker existed counts as Potomac Day 2, so nothing needs migrating.
