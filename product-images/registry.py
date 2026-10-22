BUILDERS = {}


def register(*keys):
    def deco(fn):
        for k in keys:
            BUILDERS[k] = fn
        return fn
    return deco
