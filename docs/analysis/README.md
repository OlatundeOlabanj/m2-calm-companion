# Design analysis

`design-analysis.js` drives the real baseline, tension and gate code with controlled inputs and prints the numbers used in Section 6 of the technical report.

Run it from the repository folder:

```
node docs/analysis/design-analysis.js
```

The simulations use a seeded random generator, so the output is the same every time. They assume independent Gaussian noise around a calm level of 14 breaths and 78 beats per minute. This is a convenience and not a model of real camera noise. Nothing here is data from people.

`make-figures.py` draws the two analysis figures (needs Python 3 and matplotlib). Create the folder `docs/analysis/out` first.
